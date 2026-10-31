import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { CurrentUser } from '../auth/identity-provider';
import { idsWhere } from '../common/sql';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DatabaseService } from '../database/database.service';
import { comments, contentTypes, labels, notificationRuleHits, notificationRules, notifications, summaries, summaryLabels, userFollows, users } from '../database/schema';
import { summaryVisible } from '../summaries/summary.access';

export type RuleRow = typeof notificationRules.$inferSelect;
export type RuleValues = Pick<RuleRow, 'name' | 'conditions' | 'matchAny' | 'search' | 'isMail' | 'isDigest' | 'isNotify'>;
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
  rule: Pick<RuleRow, 'id' | 'name' | 'isMail' | 'isDigest' | 'isNotify'> | null;
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
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly database: DatabaseService,
  ) {}

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
    return (await idsWhere(this.db, summaries, summaries.id, [summaryId], summaryVisible(principal, this.config.access))).has(summaryId);
  }

  async insertMany(rows: NewNotification[]): Promise<{ id: string; userId: string }[]> {
    if (!rows.length) return [];
    return this.db.insert(notifications).values(rows).returning({ id: notifications.id, userId: notifications.userId });
  }

  /** A rule matched a summary its owner was already notified about in this event: its e-mails ride on that notification. */
  async addRuleDelivery(notificationId: string, ruleId: string, mail: boolean, digest: boolean): Promise<void> {
    await this.db
      .update(notifications)
      .set({ ruleId: sql`coalesce(${notifications.ruleId}, ${ruleId}::uuid)`, mail: sql`${notifications.mail} or ${mail}`, digest: sql`${notifications.digest} or ${digest}` })
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
          ruleId: notificationRules.id,
          ruleName: notificationRules.name,
          ruleIsMail: notificationRules.isMail,
          ruleIsDigest: notificationRules.isDigest,
          ruleIsNotify: notificationRules.isNotify,
        })
        .from(notifications)
        .innerJoin(users, eq(users.id, notifications.userId))
        .leftJoin(summaries, eq(summaries.id, notifications.summaryId))
        .leftJoin(contentTypes, eq(contentTypes.id, summaries.contentTypeId))
        .leftJoin(author, eq(author.id, summaries.createdBy))
        .leftJoin(comments, eq(comments.id, notifications.commentId))
        .leftJoin(actor, eq(actor.id, notifications.createdBy))
        .leftJoin(notificationRules, eq(notificationRules.id, notifications.ruleId))
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
          rule: r.ruleId ? { id: r.ruleId, name: r.ruleName!, isMail: r.ruleIsMail!, isDigest: r.ruleIsDigest!, isNotify: r.ruleIsNotify! } : null,
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
      .where(and(eq(notifications.userId, me.id), or(isNull(notifications.summaryId), summaryVisible(me, this.config.access))))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(INBOX_LIMIT);
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

  activeRules(): Promise<RuleRow[]> {
    return this.db.select().from(notificationRules).where(eq(notificationRules.isNotify, true));
  }

  rulesOf(userId: string): Promise<RuleRow[]> {
    return this.db.select().from(notificationRules).where(eq(notificationRules.userId, userId)).orderBy(desc(notificationRules.createdAt));
  }

  async insertRule(values: RuleValues & { userId: string }): Promise<RuleRow> {
    const [row] = await this.db.insert(notificationRules).values(values).returning();
    return row;
  }

  async updateRule(userId: string, id: string, values: RuleValues): Promise<RuleRow | undefined> {
    const [row] = await this.db
      .update(notificationRules)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(notificationRules.id, id), eq(notificationRules.userId, userId)))
      .returning();
    return row;
  }

  /** Rules that already notified about this summary. */
  async ruleHits(summaryId: string): Promise<Set<string>> {
    const rows = await this.db.select({ id: notificationRuleHits.ruleId }).from(notificationRuleHits).where(eq(notificationRuleHits.summaryId, summaryId));
    return new Set(rows.map((r) => r.id));
  }

  async addRuleHit(ruleId: string, summaryId: string): Promise<void> {
    await this.db.insert(notificationRuleHits).values({ ruleId, summaryId }).onConflictDoNothing();
  }

  async deleteRule(userId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(notificationRules)
      .where(and(eq(notificationRules.id, id), eq(notificationRules.userId, userId)))
      .returning({ id: notificationRules.id });
    return rows.length > 0;
  }
}
