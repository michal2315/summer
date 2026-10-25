import { index, integer, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { permissions } from './catalog';
import { createdAt, id, updatedAt } from './columns';
import { summaries } from './summaries';
import { users } from './users';

/** Flat collections (no parent yet). A summary can be in many collections. */
export const collections = pgTable('collections', {
  id: id(),
  name: text().notNull(),
  createdBy: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  version: integer().notNull().default(1),
});

const collectionFk = () =>
  uuid()
    .notNull()
    .references(() => collections.id, { onDelete: 'cascade' });

/** Viewing requirements (all-of). Every collection needs at least one (trigger). */
export const collectionPermissions = pgTable(
  'collection_permissions',
  {
    collectionId: collectionFk(),
    permissionId: uuid()
      .notNull()
      .references(() => permissions.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.permissionId] }), index().on(t.permissionId)],
);

/** The client's collection "managers": may edit the collection's metadata and remove members. */
export const collectionEditors = pgTable(
  'collection_editors',
  {
    collectionId: collectionFk(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.userId] }), index().on(t.userId)],
);

export const summaryCollections = pgTable(
  'summary_collections',
  {
    summaryId: uuid()
      .notNull()
      .references(() => summaries.id, { onDelete: 'cascade' }),
    collectionId: collectionFk(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.summaryId, t.collectionId] }), index().on(t.collectionId, t.summaryId)],
);
