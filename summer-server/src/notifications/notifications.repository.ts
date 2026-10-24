import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { CurrentUser } from '../auth/identity-provider';
import { idsWhere } from '../common/sql';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DatabaseService } from '../database/database.service';
import { RuleCondition, notificationRules, notifications, summaries, userFollows, users } from '../database/schema';
import { summaryVisible } from '../summaries/summary.access';

export type RuleRow = typeof notificationRules.$inferSelect;

const INBOX_LIMIT = 100;
const author = alias(users, 'author');

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
  recipients(userIds: string[]): Promise<{ id: string; groupKeys: string[] }[]> {
    if (!userIds.length) return Promise.resolve([]);
    return this.db
      .select({ id: users.id, groupKeys: users.lastGroupKeys })
      .from(users)
      .where(and(inArray(users.id, userIds), eq(users.isActive, true)));
  }

  async canView(principal: CurrentUser, summaryId: string): Promise<boolean> {
    return (await idsWhere(this.db, summaries, summaries.id, [summaryId], summaryVisible(principal, this.config.access))).has(summaryId);
  }

  async insertMany(rows: { userId: string; summaryId: string | null; text: string; createdBy: string | null }[]): Promise<void> {
    if (rows.length) await this.db.insert(notifications).values(rows);
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

  async insertRule(values: { userId: string; name: string; conditions: RuleCondition[]; isMail: boolean; isNotify: boolean }): Promise<RuleRow> {
    const [row] = await this.db.insert(notificationRules).values(values).returning();
    return row;
  }

  async updateRule(
    userId: string,
    id: string,
    values: { name: string; conditions: RuleCondition[]; isMail: boolean; isNotify: boolean },
  ): Promise<RuleRow | undefined> {
    const [row] = await this.db
      .update(notificationRules)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(notificationRules.id, id), eq(notificationRules.userId, userId)))
      .returning();
    return row;
  }

  async deleteRule(userId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(notificationRules)
      .where(and(eq(notificationRules.id, id), eq(notificationRules.userId, userId)))
      .returning({ id: notificationRules.id });
    return rows.length > 0;
  }
}
