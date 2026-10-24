import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './columns';
import { summaries } from './summaries';
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
    createdAt: createdAt(),
    viewedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index().on(t.userId, t.createdAt.desc(), t.id.desc())],
);

export interface RuleCondition {
  field: { _id: string; name: string; type: string };
  funcName: string;
  content: (string | number | null)[];
}

/** Per-user rules: "notify me when a newly published summary's fields match all these conditions". */
export const notificationRules = pgTable(
  'notification_rules',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    conditions: jsonb().$type<RuleCondition[]>().notNull(),
    isMail: boolean().notNull().default(false),
    isNotify: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.userId)],
);
