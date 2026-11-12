import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { labels, permissions } from './catalog';
import { createdAt, id, updatedAt } from './columns';
import { summaries } from './summaries';
import { users } from './users';

const userFk = () =>
  uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });

/** follower follows followed. Directional; grants no access. */
export const userFollows = pgTable(
  'user_follows',
  {
    followerId: userFk(),
    followedId: userFk(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.followerId, t.followedId] }),
    index().on(t.followedId, t.followerId),
    check('user_follows_not_self', sql`${t.followerId} <> ${t.followedId}`),
  ],
);

export const userFavSummaries = pgTable(
  'user_fav_summaries',
  {
    userId: userFk(),
    summaryId: uuid()
      .notNull()
      .references(() => summaries.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.summaryId] })],
);

export const userPinnedLabels = pgTable(
  'user_pinned_labels',
  {
    userId: userFk(),
    labelId: uuid()
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.labelId] })],
);

export const userFavLabels = pgTable(
  'user_fav_labels',
  {
    userId: userFk(),
    labelId: uuid()
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.labelId] })],
);

export const userPinnedPermissions = pgTable(
  'user_pinned_permissions',
  {
    userId: userFk(),
    permissionId: uuid()
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.permissionId] })],
);

/** People the user tags often; listed first in user pickers. Directional and private, unlike follows it raises nothing. */
export const userPinnedUsers = pgTable(
  'user_pinned_users',
  {
    userId: userFk(),
    pinnedUserId: userFk(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.pinnedUserId] }), check('user_pinned_users_not_self', sql`${t.userId} <> ${t.pinnedUserId}`)],
);

export const SAVED_SEARCH_KINDS = ['simple', 'advanced'] as const;
export type SavedSearchKind = (typeof SAVED_SEARCH_KINDS)[number];

/**
 * Personal saved searches: an opaque client search object (ISummarySearch minus paging), optionally named by the user.
 * `kind` is where it was saved from (search bar: simple, advanced panel: advanced) and decides how it is edited.
 */
export const userPinnedSearches = pgTable(
  'user_pinned_searches',
  {
    id: id(),
    userId: userFk(),
    search: jsonb().$type<Record<string, unknown>>().notNull(),
    name: text(),
    kind: text().$type<SavedSearchKind>().notNull().default('simple'),
    isFavorite: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId, t.createdAt), check('user_pinned_searches_kind', sql`${t.kind} in ('simple', 'advanced')`)],
);

/** What a summary template fills in: ids as picked in the form; labels by name, since typing a new one creates it. */
export interface SummaryTemplateData {
  permissions: string[];
  taggedUsers: string[];
  /** absent in templates saved before groups could be tagged */
  taggedPermissions?: string[];
  labels: string[];
  folders?: string[];
  /** templates saved before a summary could be in several folders */
  folder?: string | null;
}

/** Personal templates for the summary form's sharing section. References are not FKs: stale ones are dropped on read. */
export const summaryTemplates = pgTable(
  'summary_templates',
  {
    id: id(),
    userId: userFk(),
    name: text().notNull(),
    data: jsonb().$type<SummaryTemplateData>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex().on(t.userId, t.name)],
);

/** What's New: one row per user per acknowledged release (the release list lives in code). */
export const whatsNewSeen = pgTable(
  'whats_new_seen',
  {
    userId: userFk(),
    version: text().notNull(),
    seenAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.version] })],
);
