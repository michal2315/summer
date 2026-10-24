import { sql } from 'drizzle-orm';
import { AnyPgColumn, check, index, integer, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { permissions } from './catalog';
import { collections } from './collections';
import { createdAt, id, updatedAt } from './columns';
import { summaries } from './summaries';
import { users } from './users';

/**
 * Hierarchy folders (/hierarchy). Each folder has zero or one parent (roots have none); parentId is set at
 * creation and never changed, so cycles cannot form. Deleting a folder deletes its subtree (FK cascade).
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
  },
  (t) => [index().on(t.parentId), check('folders_not_own_parent', sql`${t.parentId} <> ${t.id}`)],
);

const folderFk = () =>
  uuid()
    .notNull()
    .references(() => folders.id, { onDelete: 'cascade' });

/** Viewing requirements (all-of, like collections). Every folder needs at least one (trigger). */
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

/** A summary sits in at most one folder (primary key on summaryId). */
export const folderSummaries = pgTable(
  'folder_summaries',
  {
    summaryId: uuid()
      .primaryKey()
      .references(() => summaries.id, { onDelete: 'cascade' }),
    folderId: folderFk(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.folderId)],
);

/** A collection sits in at most one folder (primary key on collectionId). */
export const folderCollections = pgTable(
  'folder_collections',
  {
    collectionId: uuid()
      .primaryKey()
      .references(() => collections.id, { onDelete: 'cascade' }),
    folderId: folderFk(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.folderId)],
);
