import { boolean, index, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { permissions } from './catalog';
import { createdAt, id, updatedAt } from './columns';
import { users } from './users';

/**
 * A user group: a named set of users and permission groups someone tags together often. Picking it in a tag field
 * tags all of them. Private by default; a shared one can be found, used and copied by everyone.
 */
export const userGroups = pgTable(
  'user_groups',
  {
    id: id(),
    ownerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    isFavorite: boolean().notNull().default(false),
    isShared: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.ownerId, t.createdAt), index().on(t.isShared, t.updatedAt)],
);

export const userGroupUsers = pgTable(
  'user_group_users',
  {
    groupId: uuid()
      .notNull()
      .references(() => userGroups.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] }), index().on(t.userId)],
);

export const userGroupPermissions = pgTable(
  'user_group_permissions',
  {
    groupId: uuid()
      .notNull()
      .references(() => userGroups.id, { onDelete: 'cascade' }),
    permissionId: uuid()
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.permissionId] }), index().on(t.permissionId)],
);
