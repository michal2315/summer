import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/identity-provider';
import { CapsulesService } from '../capsules/capsules.service';
import { ApiNotification, ApiNotificationFeedItem } from '../common/api-types';
import { isUuid, parse, unique, zBoolString, zId, zList } from '../common/validation';
import { ContentTypesRepository } from '../content-types/content-types.repository';
import { NOTIFICATION_KINDS, NotificationKind, RuleCondition } from '../database/schema';
import { PermissionsRepository } from '../permissions/permissions.repository';
import { summarySearchSchema } from '../summaries/summary-search';
import { MailPreferences, NotificationsRepository, Recipient, RuleRow } from './notifications.repository';
import { CAPSULE_FUNCTIONS, RULE_FUNCTIONS, SUMMARY_TEXT_FIELD, matchRule, ruleCapsuleIds } from './rule-matcher';

const ruleBody = z.object({
  _id: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  conditions: z
    .array(
      z.object({
        field: z.object({ _id: z.string() }).passthrough(),
        funcName: z.enum(RULE_FUNCTIONS),
        content: z.array(z.union([z.string().max(500), z.number(), z.null()])).max(2),
      }),
    )
    .max(20)
    .default([]),
  /** any one condition instead of all of them */
  matchAny: z.boolean().default(false),
  /** a saved search (the client's ISummarySearch) instead of conditions */
  search: z.record(z.string(), z.unknown()).nullish(),
  isMail: z.boolean().default(false),
  isDigest: z.boolean().default(false),
  isNotify: z.boolean().default(true),
});

const FEED_PAGE = 20;
const feedQuery = z.object({
  ruleId: zId.optional(),
  /** Only these kinds; empty means all. */
  kinds: zList.pipe(z.array(z.enum(NOTIFICATION_KINDS))),
  /** Only ones not yet viewed. */
  unread: zBoolString,
  offset: z.coerce.number().int().min(0).max(100_000).default(0) });

const preferencesBody = z.object({ mailAlerts: z.boolean().optional(), mailActivity: z.boolean().optional() });

/** The parts of a saved search that select summaries (paging, sort and buckets don't apply to an alert). */
const SEARCH_KEYS = ['text', 'searchTypes', 'contentTypes', 'colors', 'users', 'labels', 'folders', 'dates', 'createdDates', 'query'];

export interface ApiRule {
  _id: string;
  name: string;
  conditions: RuleCondition[];
  matchAny: boolean;
  search?: Record<string, unknown>;
  isMail: boolean;
  isDigest: boolean;
  isNotify: boolean;
  creationDate: string;
}

const toApiRule = (r: RuleRow): ApiRule => ({
  _id: r.id,
  name: r.name,
  conditions: r.conditions,
  matchAny: r.matchAny,
  ...(r.search ? { search: r.search } : {}),
  isMail: r.isMail,
  isDigest: r.isDigest,
  isNotify: r.isNotify,
  creationDate: r.createdAt.toISOString(),
});

/** A stored notification and who got it. */
interface Delivered {
  notificationId: string;
  recipient: Recipient;
}

/**
 * E-mail is decided when the notification is created: activity mails follow the recipient's `mailActivity`; a rule's
 * mails follow the rule's own choices, under the recipient's `mailAlerts`. No address, no mail.
 */
function mailFlags(u: Recipient, rule?: Pick<RuleRow, 'isMail' | 'isDigest'>): { mail: boolean; digest: boolean } {
  if (!u.email) return { mail: false, digest: false };
  if (!rule) return { mail: u.mailActivity, digest: false };
  return { mail: u.mailAlerts && rule.isMail, digest: u.mailAlerts && rule.isDigest };
}

/** What fan-out needs to know about a published (or edited) summary. */
export interface PublishedSummary {
  id: string;
  title: string;
  fieldValues: Map<string, string>;
  /** Does the summary match this saved search (the feed's own SQL)? */
  matchesSearch: (search: Record<string, unknown>) => Promise<boolean>;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly repo: NotificationsRepository,
    private readonly contentTypes: ContentTypesRepository,
    private readonly permissions: PermissionsRepository,
    private readonly capsules: CapsulesService,
  ) {}

  /**
   * Store one notification per recipient who can (by last-known groups) see the summary. Never notifies the actor.
   * Runs inside the caller's transaction, so it commits or rolls back with the change that caused it.
   */
  async notify(recipientIds: string[], n: { summaryId: string; text: string; kind: NotificationKind; createdBy: string; commentId?: string }, rule?: RuleRow): Promise<Delivered[]> {
    const candidates = unique(recipientIds).filter((id) => id !== n.createdBy);
    const allowed = await this.whoCanView(candidates, n.summaryId);
    const rows = await this.repo.insertMany(
      allowed.map((u) => ({ userId: u.id, summaryId: n.summaryId, text: n.text, kind: n.kind, createdBy: n.createdBy, commentId: n.commentId, ruleId: rule?.id, ...mailFlags(u, rule) })),
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

  /** A summary became visible to others (created published, or a draft was published): followers + matching rules. */
  async onPublished(s: PublishedSummary, author: CurrentUser): Promise<void> {
    const followers = await this.repo.followerIds(author.id);
    const sent = await this.notify(followers, { summaryId: s.id, text: `${author.fullName} פרסם/ה תמצית חדשה "${s.title}"`, kind: 'follow', createdBy: author.id });
    const notified = new Map(sent.map((d) => [d.recipient.id, d]));

    await this.notifyRules(s, author, notified, 'חדשה');
  }

  /** A published summary was edited: it may match rules now that it didn't before. */
  async onUpdated(s: PublishedSummary, author: CurrentUser): Promise<void> {
    await this.notifyRules(s, author, new Map(), 'שעודכנה');
  }

  /**
   * Each rule notifies its owner once per summary, the first time the summary matches (rule hits remember it).
   * One notification per person per event: a rule whose owner was already told this time records its hit and adds
   * its e-mails to that notification.
   */
  private async notifyRules(s: PublishedSummary, author: CurrentUser, notified: Map<string, Delivered>, what: string): Promise<void> {
    const rules = await this.repo.activeRules();
    const done = await this.repo.ruleHits(s.id);
    const capsules = await this.capsules.lookup({ ids: rules.flatMap((r) => ruleCapsuleIds(r.conditions)) });
    for (const rule of rules) {
      if (rule.userId === author.id || done.has(rule.id)) continue;
      const match = rule.search ? await s.matchesSearch(rule.search) : matchRule(rule.conditions, s.fieldValues, capsules, rule.matchAny);
      if (!match) continue;
      const earlier = notified.get(rule.userId);
      if (earlier) {
        const { mail, digest } = mailFlags(earlier.recipient, rule);
        if (mail || digest) await this.repo.addRuleDelivery(earlier.notificationId, rule.id, mail, digest);
        await this.repo.addRuleHit(rule.id, s.id);
        continue;
      }
      const kind = rule.search ? 'לחיפוש' : 'לכלל';
      const sent = await this.notify([rule.userId], { summaryId: s.id, text: `תמצית ${what} תואמת ${kind} "${rule.name}": "${s.title}"`, kind: rule.search ? 'search' : 'rule', createdBy: author.id }, rule);
      if (!sent.length) continue;
      await this.repo.addRuleHit(rule.id, s.id);
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
    const rows = await this.repo.feed(me, { ruleId: q.ruleId, kinds: q.kinds, unread: q.unread, offset: q.offset, limit: FEED_PAGE });
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
        ...(r.ruleId ? { rule: { _id: r.ruleId, name: r.ruleName! } } : {}),
      })),
    };
  }

  markViewed(me: CurrentUser, id?: string): Promise<void> {
    return this.repo.markViewed(me.id, id);
  }

  async rules(me: CurrentUser): Promise<ApiRule[]> {
    return (await this.repo.rulesOf(me.id)).map(toApiRule);
  }

  async saveRule(me: CurrentUser, body: unknown, mode: 'create' | 'update'): Promise<ApiRule> {
    const { _id, ...input } = parse(ruleBody, body);
    // Snapshot field name/type from the catalog rather than trusting the client's copy.
    const fields = new Map((await this.contentTypes.fieldsByIds(unique(input.conditions.map((c) => c.field._id).filter(isUuid)))).map((f) => [f.id, f]));
    const conditions: RuleCondition[] = input.conditions.map((c) => {
      const f = c.field._id === SUMMARY_TEXT_FIELD._id ? { ...SUMMARY_TEXT_FIELD, id: SUMMARY_TEXT_FIELD._id } : fields.get(c.field._id);
      if (!f) throw new BadRequestException(`unknown field ${c.field._id}`);
      if (CAPSULE_FUNCTIONS.includes(c.funcName) && (f.type !== 'string' || typeof c.content[0] !== 'string' || !c.content[0]))
        throw new BadRequestException(`${c.funcName} needs a text field and a capsule id`);
      return { field: { _id: f.id, name: f.name, type: f.type }, funcName: c.funcName, content: c.content };
    });
    const search = input.search ? Object.fromEntries(Object.entries(input.search).filter(([k, v]) => SEARCH_KEYS.includes(k) && v !== undefined && v !== null)) : null;
    if (search && !summarySearchSchema.safeParse(search).success) throw new BadRequestException('invalid search');
    if (!conditions.length && !search) throw new BadRequestException('a rule needs conditions or a search');
    const values = { name: input.name, conditions: search ? [] : conditions, matchAny: input.matchAny, search, isMail: input.isMail, isDigest: input.isDigest, isNotify: input.isNotify };
    if (mode === 'create') return toApiRule(await this.repo.insertRule({ userId: me.id, ...values }));
    if (!_id || !isUuid(_id)) throw new NotFoundException();
    const row = await this.repo.updateRule(me.id, _id, values);
    if (!row) throw new NotFoundException();
    return toApiRule(row);
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

  async deleteRule(me: CurrentUser, id: string): Promise<void> {
    if (!(await this.repo.deleteRule(me.id, id))) throw new NotFoundException();
  }
}

