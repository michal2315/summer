import { sql } from 'drizzle-orm';
import { AnyPgColumn, boolean, check, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { permissions } from './catalog';
import { createdAt, id, updatedAt } from './columns';
import { summaries } from './summaries';
import { users } from './users';

/**
 * Hierarchy folders (/hierarchy). Each folder has zero or one parent (roots have none). Moves are serialized and
 * checked for cycles by FoldersService.move. Deleting a folder deletes its subtree (FK cascade).
 *
 * The one legacy root (isLegacyRoot) holds the collections imported from the old Summer, one flat folder each, while
 * people sort them into the hierarchy on the staging page. Summaries the old Summer had in no collection are placed in
 * the root itself, and each author sorts their own. It has no permissions and no managers, and nothing can be
 * added to it or to the collections in it: things only leave (see folders/legacy.service.ts).
 */
export const folders = pgTable(
  'folders',
  {
    id: id(),
    name: text().notNull(),
    parentId: uuid().references((): AnyPgColumn => folders.id, { onDelete: 'cascade' }),
    createdBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: integer().notNull().default(1),
    isLegacyRoot: boolean().notNull().default(false),
  },
  (t) => [
    index().on(t.parentId),
    check('folders_not_own_parent', sql`${t.parentId} <> ${t.id}`),
    check('folders_legacy_root_at_top', sql`not ${t.isLegacyRoot} or ${t.parentId} is null`),
    uniqueIndex('folders_one_legacy_root').on(t.isLegacyRoot).where(sql`${t.isLegacyRoot}`),
  ],
);

const folderFk = () =>
  uuid()
    .notNull()
    .references(() => folders.id, { onDelete: 'cascade' });

/** Viewing requirements (all-of). Every folder needs at least one (trigger), except the legacy root. */
export const folderPermissions = pgTable(
  'folder_permissions',
  {
    folderId: folderFk(),
    permissionId: uuid()
      .notNull()
      .references(() => permissions.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.folderId, t.permissionId] }), index().on(t.permissionId)],
);

/** The client's folder "managers": edit the folder, create subfolders, place/remove items, delete. */
export const folderEditors = pgTable(
  'folder_editors',
  {
    folderId: folderFk(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.folderId, t.userId] }), index().on(t.userId)],
);

/** A summary can sit in any number of folders; it is the same summary in each (not a copy). */
export const folderSummaries = pgTable(
  'folder_summaries',
  {
    summaryId: uuid()
      .notNull()
      .references(() => summaries.id, { onDelete: 'cascade' }),
    folderId: folderFk(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.summaryId, t.folderId] }), index().on(t.folderId)],
);

/**
 * One row per collection put in the legacy root. It stays after the collection leaves or is deleted, so the staging
 * page's progress bar keeps its total. `total`: the collection's placements when it was registered. `managers`: copied
 * from the folder when it is deleted (until then the folder's own managers count).
 */
export const legacyCollections = pgTable('legacy_collections', {
  folderId: uuid().primaryKey(),
  name: text().notNull(),
  total: integer().notNull(),
  managers: uuid().array().notNull().default(sql`'{}'::uuid[]`),
  createdAt: createdAt(),
  deletedAt: timestamp({ withTimezone: true }),
});

/** Summaries taken out of a legacy collection. Undoing that is the only way back in, and it needs a row here. */
export const legacyReleases = pgTable(
  'legacy_releases',
  {
    folderId: folderFk(),
    summaryId: uuid()
      .notNull()
      .references(() => summaries.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.folderId, t.summaryId] })],
);
