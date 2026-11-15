import { Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/identity-provider';
import { ApiNotification, ApiNotificationFeedItem } from '../common/api-types';
import { parse, unique, zBoolString, zId, zList } from '../common/validation';
import { NOTIFICATION_KINDS, NotificationKind } from '../database/schema';
import { PermissionsRepository } from '../permissions/permissions.repository';
import { alertPart } from '../queries/query-search';
import { AlertRule, MailPreferences, NotificationsRepository, Recipient } from './notifications.repository';

const FEED_PAGE = 20;
const feedQuery = z.object({
  queryId: zId.optional(),
  /** Only these kinds; empty means all. */
  kinds: zList.pipe(z.array(z.enum(NOTIFICATION_KINDS))),
  /** Only ones not yet viewed. */
  unread: zBoolString,
  offset: z.coerce.number().int().min(0).max(100_000).default(0) });

const preferencesBody = z.object({ mailAlerts: z.boolean().optional(), mailActivity: z.boolean().optional() });

/** A stored notification and who got it. */
interface Delivered {
  notificationId: string;
  recipient: Recipient;
}

/**
 * E-mail is decided when the notification is created: activity mails follow the recipient's `mailActivity`; an
 * alert's mails follow the alert's own choices, under the recipient's `mailAlerts`. No address, no mail.
 */
function mailFlags(u: Recipient, alert?: Pick<AlertRule, 'isMail' | 'isDigest'>): { mail: boolean; digest: boolean } {
  if (!u.email) return { mail: false, digest: false };
  if (!alert) return { mail: u.mailActivity, digest: false };
  return { mail: u.mailAlerts && alert.isMail, digest: u.mailAlerts && alert.isDigest };
}

/** What fan-out needs to know about a published (or edited) summary. */
export interface PublishedSummary {
  id: string;
  title: string;
  /** Does the summary match this query's search (the feed's own SQL)? */
  matchesSearch: (search: Record<string, unknown>) => Promise<boolean>;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly repo: NotificationsRepository,
    private readonly permissions: PermissionsRepository,
  ) {}

  /**
   * Store one notification per recipient who can (by last-known groups) see the summary. Never notifies the actor.
   * Runs inside the caller's transaction, so it commits or rolls back with the change that caused it.
   */
  async notify(recipientIds: string[], n: { summaryId: string; text: string; kind: NotificationKind; createdBy: string; commentId?: string }, alert?: AlertRule): Promise<Delivered[]> {
    const candidates = unique(recipientIds).filter((id) => id !== n.createdBy);
    const allowed = await this.whoCanView(candidates, n.summaryId);
    const rows = await this.repo.insertMany(
      allowed.map((u) => ({ userId: u.id, summaryId: n.summaryId, text: n.text, kind: n.kind, createdBy: n.createdBy, commentId: n.commentId, alertId: alert?.id, ...mailFlags(u, alert) })),
    );
    const byUser = new Map(allowed.map((u) => [u.id, u]));
    return rows.map((r) => ({ notificationId: r.id, recipient: byUser.get(r.userId)! }));
  }

  /**
   * notify() for tagged permission groups: every member (by last-known groups) once, under the first group they are in.
   * `skip` holds people already notified about this event. Returns everyone covered, so callers can chain.
   */
  async notifyGroups(
    permissionIds: string[],
    n: { summaryId: string; kind: NotificationKind; createdBy: string; commentId?: string },
    text: (groupName: string) => string,
    skip: string[] = [],
  ): Promise<string[]> {
    const told = new Set(skip);
    for (const p of await this.permissions.byIds(unique(permissionIds))) {
      const members = (await this.repo.groupMemberIds(p.groupName)).filter((id) => !told.has(id));
      members.forEach((id) => told.add(id));
      await this.notify(members, { ...n, text: text(p.name) });
    }
    return [...told];
  }

  /**
   * Which recipients (judged by their last-known groups) can see the summary. Only decides whether to create a
   * notification; reading the inbox re-authorizes with fresh groups, so a stale cache never exposes content.
   */
  private async whoCanView(userIds: string[], summaryId: string): Promise<Recipient[]> {
    const allowed: Recipient[] = [];
    for (const u of await this.repo.recipients(userIds)) if (await this.canView(u, summaryId)) allowed.push(u);
    return allowed;
  }

  /** By the recipient's last-known groups (see whoCanView); the mail worker re-checks with it before sending. */
  async canView(u: Pick<Recipient, 'id' | 'groupKeys'>, summaryId: string): Promise<boolean> {
    const principal = { id: u.id, permissionIds: await this.permissions.idsForGroupKeys(u.groupKeys) } as CurrentUser;
    return this.repo.canView(principal, summaryId);
  }

  /** A summary became visible to others (created published, or a draft was published): followers + matching alerts. */
  async onPublished(s: PublishedSummary, author: CurrentUser): Promise<void> {
    const followers = await this.repo.followerIds(author.id);
    const sent = await this.notify(followers, { summaryId: s.id, text: `${author.fullName} פרסם/ה תמצית חדשה "${s.title}"`, kind: 'follow', createdBy: author.id });
    const notified = new Map(sent.map((d) => [d.recipient.id, d]));

    await this.notifyAlerts(s, author, notified, 'חדשה');
  }

  /** A published summary was edited: it may match queries now that it didn't before. */
  async onUpdated(s: PublishedSummary, author: CurrentUser): Promise<void> {
    await this.notifyAlerts(s, author, new Map(), 'שעודכנה');
  }

  /**
   * Each alert notifies its user once per summary, the first time the summary matches its query (alert hits remember
   * it). One notification per person per event: an alert whose user was already told this time records its hit and
   * adds its e-mails to that notification.
   */
  private async notifyAlerts(s: PublishedSummary, author: CurrentUser, notified: Map<string, Delivered>, what: string): Promise<void> {
    const alerts = await this.repo.activeAlerts();
    const done = await this.repo.alertHits(s.id);
    for (const alert of alerts) {
      if (alert.userId === author.id || done.has(alert.id)) continue;
      if (!(await s.matchesSearch(alertPart(alert.search)))) continue;
      const earlier = notified.get(alert.userId);
      if (earlier) {
        const { mail, digest } = mailFlags(earlier.recipient, alert);
        if (mail || digest) await this.repo.addAlertDelivery(earlier.notificationId, alert.id, mail, digest);
        await this.repo.addAlertHit(alert.id, s.id);
        continue;
      }
      const sent = await this.notify([alert.userId], { summaryId: s.id, text: `תמצית ${what} תואמת לחיפוש "${alert.name}": "${s.title}"`, kind: 'alert', createdBy: author.id }, alert);
      if (!sent.length) continue;
      await this.repo.addAlertHit(alert.id, s.id);
      sent.forEach((d) => notified.set(d.recipient.id, d));
    }
  }

  async inbox(me: CurrentUser): Promise<ApiNotification[]> {
    const rows = await this.repo.inbox(me);
    return rows.map((r) => ({
      _id: r.id,
      text: r.text,
      summaryId: r.summaryId ?? undefined,
      creationDate: r.createdAt.toISOString(),
      isViewed: r.viewedAt !== null,
      createdBy: r.authorId ? { _id: r.authorId, username: r.authorUsername!, fullName: r.authorFullName! } : undefined,
    }));
  }

  /** One page of the notifications-page feed (the caller attaches the summaries). */
  async feed(me: CurrentUser, query: unknown): Promise<{ items: Omit<ApiNotificationFeedItem, 'summary'>[]; hasMore: boolean }> {
    const q = parse(feedQuery, query ?? {});
    const rows = await this.repo.feed(me, { queryId: q.queryId, kinds: q.kinds, unread: q.unread, offset: q.offset, limit: FEED_PAGE });
    return {
      hasMore: rows.length > FEED_PAGE,
      items: rows.slice(0, FEED_PAGE).map((r) => ({
        _id: r.id,
        text: r.text,
        summaryId: r.summaryId ?? undefined,
        creationDate: r.createdAt.toISOString(),
        isViewed: r.viewedAt !== null,
        createdBy: r.authorId ? { _id: r.authorId, username: r.authorUsername!, fullName: r.authorFullName! } : undefined,
        kind: r.kind,
        ...(r.queryId ? { query: { _id: r.queryId, name: r.queryName! } } : {}),
      })),
    };
  }

  markViewed(me: CurrentUser, id?: string): Promise<void> {
    return this.repo.markViewed(me.id, id);
  }

  async preferences(me: CurrentUser): Promise<MailPreferences> {
    const prefs = await this.repo.mailPreferences(me.id);
    if (!prefs) throw new NotFoundException();
    return prefs;
  }

  async setPreferences(me: CurrentUser, body: unknown): Promise<MailPreferences> {
    await this.repo.setMailPreferences(me.id, parse(preferencesBody, body));
    return this.preferences(me);
  }
}
