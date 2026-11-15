import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { CurrentUser } from '../auth/identity-provider';
import { idsWhere } from '../common/sql';
import { DatabaseService } from '../database/database.service';
import { NotificationKind, comments, contentTypes, labels, notifications, queries, queryAlertHits, queryAlerts, summaries, summaryLabels, userFollows, users } from '../database/schema';
import { summaryVisible } from '../summaries/summary.access';

/** An active alert as fan-out needs it: whom it notifies, how, and its query. */
export interface AlertRule {
  /** the alert's id */
  id: string;
  userId: string;
  isActive: boolean;
  isMail: boolean;
  isDigest: boolean;
  /** the query's name */
  name: string;
  search: Record<string, unknown>;
}

export type NewNotification = typeof notifications.$inferInsert;

/** A user who may receive notifications, with what deciding their e-mail needs. */
export interface Recipient {
  id: string;
  groupKeys: string[];
  email: string | null;
  mailAlerts: boolean;
  mailActivity: boolean;
}

/** What an e-mail shows about the summary. */
export interface MailSummaryDetails {
  contentType: string | null;
  author: string | null;
  eventDate: Date | null;
  eventHasTime: boolean;
  labels: string[];
  /** Plain text of the content (the template shortens it). */
  contentText: string;
}

/** A notification claimed for e-mail, with everything the worker needs to re-check and send it. */
export interface MailRow {
  id: string;
  text: string;
  summaryId: string | null;
  summaryTitle: string | null;
  summary: MailSummaryDetails | null;
  /** The comment it is about, if any. */
  comment: string | null;
  /** Who caused it (null for system notifications). */
  actorName: string | null;
  mailAttempts: number;
  recipient: Recipient;
  alert: Pick<AlertRule, 'id' | 'name' | 'isMail' | 'isDigest' | 'isActive'> | null;
}

export interface MailPreferences {
  email: string | null;
  mailAlerts: boolean;
  mailActivity: boolean;
}

const INBOX_LIMIT = 100;
const author = alias(users, 'author');
const actor = alias(users, 'actor');

@Injectable()
export class NotificationsRepository {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  /** Active users among `userIds` with their last-known group keys (a cache — see users.last_group_keys). */
  recipients(userIds: string[]): Promise<Recipient[]> {
    if (!userIds.length) return Promise.resolve([]);
    return this.db
      .select({ id: users.id, groupKeys: users.lastGroupKeys, email: users.email, mailAlerts: users.mailAlerts, mailActivity: users.mailActivity })
      .from(users)
      .where(and(inArray(users.id, userIds), eq(users.isActive, true)));
  }

  /** Active, non-system users whose last-known groups include `groupKey` (a tagged permission group's members). */
  async groupMemberIds(groupKey: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.isActive, true), eq(users.isSystem, false), sql`${groupKey} = any(${users.lastGroupKeys})`));
    return rows.map((r) => r.id);
  }

  async canView(principal: CurrentUser, summaryId: string): Promise<boolean> {
    return (await idsWhere(this.db, summaries, summaries.id, [summaryId], summaryVisible(principal))).has(summaryId);
  }

  async insertMany(rows: NewNotification[]): Promise<{ id: string; userId: string }[]> {
    if (!rows.length) return [];
    return this.db.insert(notifications).values(rows).returning({ id: notifications.id, userId: notifications.userId });
  }

  /** An alert matched a summary its user was already notified about in this event: its e-mails ride on that notification. */
  async addAlertDelivery(notificationId: string, alertId: string, mail: boolean, digest: boolean): Promise<void> {
    await this.db
      .update(notifications)
      .set({ alertId: sql`coalesce(${notifications.alertId}, ${alertId}::uuid)`, mail: sql`${notifications.mail} or ${mail}`, digest: sql`${notifications.digest} or ${digest}` })
      .where(eq(notifications.id, notificationId));
  }

  /**
   * Take up to `limit` pending e-mails (immediate, or digest rows created before `before`) and clear their flag, so
   * concurrent workers never claim the same row. Delivery is at most once: a crash after claiming drops those mails.
   */
  async claimMail(kind: 'mail' | 'digest', limit: number, before?: Date): Promise<MailRow[]> {
    const flag = notifications[kind];
    return this.database.transaction(async () => {
      const ids = (
        await this.db
          .select({ id: notifications.id })
          .from(notifications)
          .where(and(eq(flag, true), before ? lt(notifications.createdAt, before) : undefined))
          .orderBy(asc(notifications.createdAt))
          .limit(limit)
          .for('update', { skipLocked: true })
      ).map((r) => r.id);
      if (!ids.length) return [];
      await this.db.update(notifications).set({ [kind]: false }).where(inArray(notifications.id, ids));
      const rows = await this.db
        .select({
          id: notifications.id,
          text: notifications.text,
          summaryId: notifications.summaryId,
          summaryTitle: summaries.title,
          contentText: summaries.contentText,
          eventDate: summaries.eventDate,
          eventHasTime: summaries.eventHasTime,
          contentType: contentTypes.displayName,
          summaryAuthor: author.fullName,
          labels: sql<string[]>`(select coalesce(array_agg(${labels.name} order by ${labels.name}), '{}') from ${summaryLabels} join ${labels} on ${labels.id} = ${summaryLabels.labelId} where ${summaryLabels.summaryId} = ${summaries.id})`,
          comment: comments.content,
          actorName: actor.fullName,
          mailAttempts: notifications.mailAttempts,
          userId: users.id,
          groupKeys: users.lastGroupKeys,
          email: users.email,
          isActive: users.isActive,
          mailAlerts: users.mailAlerts,
          mailActivity: users.mailActivity,
          alertId: queryAlerts.id,
          alertName: queries.name,
          alertIsMail: queryAlerts.isMail,
          alertIsDigest: queryAlerts.isDigest,
          alertIsActive: queryAlerts.isActive,
        })
        .from(notifications)
        .innerJoin(users, eq(users.id, notifications.userId))
        .leftJoin(summaries, eq(summaries.id, notifications.summaryId))
        .leftJoin(contentTypes, eq(contentTypes.id, summaries.contentTypeId))
        .leftJoin(author, eq(author.id, summaries.createdBy))
        .leftJoin(comments, eq(comments.id, notifications.commentId))
        .leftJoin(actor, eq(actor.id, notifications.createdBy))
        .leftJoin(queryAlerts, eq(queryAlerts.id, notifications.alertId))
        .leftJoin(queries, eq(queries.id, queryAlerts.queryId))
        .where(inArray(notifications.id, ids))
        .orderBy(asc(notifications.createdAt));
      return rows
        .filter((r) => r.isActive)
        .map((r) => ({
          id: r.id,
          text: r.text,
          summaryId: r.summaryId,
          summaryTitle: r.summaryTitle,
          summary: r.summaryTitle === null ? null : { contentType: r.contentType, author: r.summaryAuthor, eventDate: r.eventDate, eventHasTime: r.eventHasTime ?? false, labels: r.labels ?? [], contentText: r.contentText ?? '' },
          comment: r.comment,
          actorName: r.actorName,
          mailAttempts: r.mailAttempts,
          recipient: { id: r.userId, groupKeys: r.groupKeys, email: r.email, mailAlerts: r.mailAlerts, mailActivity: r.mailActivity },
          alert: r.alertId ? { id: r.alertId, name: r.alertName!, isMail: r.alertIsMail!, isDigest: r.alertIsDigest!, isActive: r.alertIsActive! } : null,
        }));
    });
  }

  /** Put mails whose delivery failed back in the outbox, counting the attempt. */
  async requeueMail(kind: 'mail' | 'digest', ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.db
      .update(notifications)
      .set({ [kind]: true, mailAttempts: sql`${notifications.mailAttempts} + 1` })
      .where(inArray(notifications.id, ids));
  }

  async mailPreferences(userId: string): Promise<MailPreferences | undefined> {
    const [row] = await this.db.select({ email: users.email, mailAlerts: users.mailAlerts, mailActivity: users.mailActivity }).from(users).where(eq(users.id, userId));
    return row;
  }

  async setMailPreferences(userId: string, values: Partial<Pick<MailPreferences, 'mailAlerts' | 'mailActivity'>>): Promise<void> {
    if (Object.keys(values).length) await this.db.update(users).set({ ...values, updatedAt: new Date() }).where(eq(users.id, userId));
  }

  /** Newest first. Re-authorizes the target now: a notification never outlives access to its summary. */
  inbox(me: CurrentUser) {
    return this.db
      .select({
        id: notifications.id,
        text: notifications.text,
        summaryId: notifications.summaryId,
        createdAt: notifications.createdAt,
        viewedAt: notifications.viewedAt,
        authorId: author.id,
        authorUsername: author.username,
        authorFullName: author.fullName,
      })
      .from(notifications)
      .leftJoin(summaries, eq(summaries.id, notifications.summaryId))
      .leftJoin(author, eq(author.id, notifications.createdBy))
      .where(and(eq(notifications.userId, me.id), or(isNull(notifications.summaryId), summaryVisible(me))))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(INBOX_LIMIT);
  }

  /**
   * The notifications page feed: notifications about a summary the caller can still see, newest first,
   * optionally only those one query's alert raised. Paged by offset; one row past `limit` tells the caller there's more.
   */
  feed(me: CurrentUser, opts: { queryId?: string; kinds: NotificationKind[]; unread: boolean; offset: number; limit: number }) {
    return this.db
      .select({
        id: notifications.id,
        text: notifications.text,
        summaryId: notifications.summaryId,
        createdAt: notifications.createdAt,
        viewedAt: notifications.viewedAt,
        queryId: queries.id,
        queryName: queries.name,
        kind: notifications.kind,
        authorId: author.id,
        authorUsername: author.username,
        authorFullName: author.fullName,
      })
      .from(notifications)
      .innerJoin(summaries, eq(summaries.id, notifications.summaryId))
      .leftJoin(author, eq(author.id, notifications.createdBy))
      .leftJoin(queryAlerts, eq(queryAlerts.id, notifications.alertId))
      .leftJoin(queries, eq(queries.id, queryAlerts.queryId))
      .where(and(eq(notifications.userId, me.id), summaryVisible(me), opts.queryId ? eq(queries.id, opts.queryId) : undefined, opts.kinds.length ? inArray(notifications.kind, opts.kinds) : undefined, opts.unread ? isNull(notifications.viewedAt) : undefined))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .offset(opts.offset)
      .limit(opts.limit + 1);
  }

  async markViewed(userId: string, id?: string): Promise<void> {
    await this.db
      .update(notifications)
      .set({ viewedAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.viewedAt), id ? eq(notifications.id, id) : undefined));
  }

  async followerIds(userId: string): Promise<string[]> {
    const rows = await this.db.select({ id: userFollows.followerId }).from(userFollows).where(eq(userFollows.followedId, userId));
    return rows.map((r) => r.id);
  }

  /** Every active alert with its query, oldest first (so who is told first doesn't change between runs). */
  activeAlerts(): Promise<AlertRule[]> {
    return this.db
      .select({
        id: queryAlerts.id,
        userId: queryAlerts.userId,
        isActive: queryAlerts.isActive,
        isMail: queryAlerts.isMail,
        isDigest: queryAlerts.isDigest,
        name: queries.name,
        search: queries.search,
      })
      .from(queryAlerts)
      .innerJoin(queries, eq(queries.id, queryAlerts.queryId))
      .where(eq(queryAlerts.isActive, true))
      .orderBy(asc(queryAlerts.createdAt), asc(queryAlerts.id));
  }

  /** Alerts that already notified about this summary. */
  async alertHits(summaryId: string): Promise<Set<string>> {
    const rows = await this.db.select({ id: queryAlertHits.alertId }).from(queryAlertHits).where(eq(queryAlertHits.summaryId, summaryId));
    return new Set(rows.map((r) => r.id));
  }

  async addAlertHit(alertId: string, summaryId: string): Promise<void> {
    await this.db.insert(queryAlertHits).values({ alertId, summaryId }).onConflictDoNothing();
  }
}
