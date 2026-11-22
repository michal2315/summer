import { sql } from 'drizzle-orm';
import { AnyPgColumn, boolean, index, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id } from './columns';
import { queryAlerts } from './queries';
import { comments, summaries } from './summaries';
import { users } from './users';

export const NOTIFICATION_KINDS = ['alert', 'comment', 'mention', 'tag', 'follow'] as const;
/** alert: a query's alert matched a summary; the rest is activity by another user. */
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

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
    /** What raised it (the notifications page filters by it). */
    kind: text().$type<NotificationKind>().notNull(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** The alert that raised it; null for activity (tags, comments, mentions, followed users). */
    alertId: uuid().references((): AnyPgColumn => queryAlerts.id, { onDelete: 'set null' }),
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
