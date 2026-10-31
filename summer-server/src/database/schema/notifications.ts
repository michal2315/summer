import { sql } from 'drizzle-orm';
import { AnyPgColumn, boolean, index, jsonb, pgTable, primaryKey, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './columns';
import { comments, summaries } from './summaries';
import { users } from './users';

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    /** Recipient. */
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    summaryId: uuid().references(() => summaries.id, { onDelete: 'cascade' }),
    text: text().notNull(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** The rule that raised it; null for activity (tags, comments, mentions, followed users). */
    ruleId: uuid().references((): AnyPgColumn => notificationRules.id, { onDelete: 'set null' }),
    /** The comment it is about (comment on your summary, mention); e-mails quote it. */
    commentId: uuid().references(() => comments.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    viewedAt: timestamp({ withTimezone: true }),
    /** Outbox: e-mail this notification (cleared when the mail worker claims it). */
    mail: boolean().notNull().default(false),
    /** Outbox: list it in the recipient's next daily digest (cleared when the digest goes out). */
    digest: boolean().notNull().default(false),
    /** Failed deliveries so far; the worker stops retrying after a few. */
    mailAttempts: smallint().notNull().default(0),
  },
  (t) => [
    index().on(t.userId, t.createdAt.desc(), t.id.desc()),
    index('notifications_mail_pending_index').on(t.createdAt).where(sql`${t.mail}`),
    index('notifications_digest_pending_index').on(t.createdAt).where(sql`${t.digest}`),
  ],
);

export interface RuleCondition {
  field: { _id: string; name: string; type: string };
  funcName: string;
  content: (string | number | null)[];
}

/**
 * Per-user rules: "notify me when a published summary matches". A rule is either field conditions (all of them, or
 * any one with `matchAny`) or a saved search (`search`, the client's ISummarySearch, matched with the feed's SQL).
 */
export const notificationRules = pgTable(
  'notification_rules',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    conditions: jsonb().$type<RuleCondition[]>().notNull(),
    matchAny: boolean().notNull().default(false),
    search: jsonb().$type<Record<string, unknown>>(),
    /** Also e-mail each match right away. */
    isMail: boolean().notNull().default(false),
    /** Also list matches in the owner's daily digest e-mail. */
    isDigest: boolean().notNull().default(false),
    /** The rule is active: matches reach the bell (and the e-mails above). Off pauses the rule. */
    isNotify: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.userId)],
);

/** Which rule already notified about which summary, so re-checking on every edit notifies once. */
export const notificationRuleHits = pgTable(
  'notification_rule_hits',
  {
    ruleId: uuid()
      .notNull()
      .references(() => notificationRules.id, { onDelete: 'cascade' }),
    summaryId: uuid()
      .notNull()
      .references(() => summaries.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.ruleId, t.summaryId] }), index().on(t.summaryId)],
);
