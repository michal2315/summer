import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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

/** Saved searches: an opaque client search object (ISummarySearch minus paging). */
export const userPinnedSearches = pgTable(
  'user_pinned_searches',
  {
    id: id(),
    userId: userFk(),
    search: jsonb().$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId, t.createdAt)],
);

/** What a summary template fills in: ids as picked in the form; labels by name, since typing a new one creates it. */
export interface SummaryTemplateData {
  permissions: string[];
  taggedUsers: string[];
  /** absent in templates saved before groups could be tagged */
  taggedPermissions?: string[];
  labels: string[];
  folder: string | null;
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
