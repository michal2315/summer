import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './columns';
import { summaries } from './summaries';
import { users } from './users';

export const QUERY_KINDS = ['simple', 'advanced'] as const;
/** How a query is edited: the search box text only (simple), or with the condition builder too (advanced). */
export type QueryKind = (typeof QUERY_KINDS)[number];

/**
 * A query: a named search over summaries (the client's ISummarySearch, without paging). Every query is a saved search
 * of its owner's, and can carry alerts (query_alerts) that notify about summaries it finds later.
 */
export const queries = pgTable(
  'queries',
  {
    id: id(),
    ownerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    kind: text().$type<QueryKind>().notNull().default('simple'),
    search: jsonb().$type<Record<string, unknown>>().notNull(),
    isFavorite: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.ownerId, t.createdAt), check('queries_kind', sql`${t.kind} in ('simple', 'advanced')`)],
);

/**
 * "Notify this user about summaries the query finds", with how. One per query and user; today only the owner has one,
 * but the table is shaped for sharing a query with others.
 */
export const queryAlerts = pgTable(
  'query_alerts',
  {
    id: id(),
    queryId: uuid()
      .notNull()
      .references(() => queries.id, { onDelete: 'cascade' }),
    /** Who is notified. */
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Matches reach the bell (and the e-mails below). Off pauses the alert. */
    isActive: boolean().notNull().default(true),
    /** Also e-mail each match right away. */
    isMail: boolean().notNull().default(false),
    /** Also list matches in the daily digest e-mail. */
    isDigest: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.queryId, t.userId), index().on(t.userId)],
);

/** Which alert already notified about which summary, so re-checking on every edit notifies once. */
export const queryAlertHits = pgTable(
  'query_alert_hits',
  {
    alertId: uuid()
      .notNull()
      .references(() => queryAlerts.id, { onDelete: 'cascade' }),
    summaryId: uuid()
      .notNull()
      .references(() => summaries.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.alertId, t.summaryId] }), index().on(t.summaryId)],
);
