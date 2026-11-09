import { boolean, integer, pgEnum, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './columns';

/**
 * Viewing-permission catalog. `groupName` is the external (SSO/AD) group key; a user holds a permission
 * when the identity provider reports that group. This is not a per-user assignment table.
 */
export const permissions = pgTable('permissions', {
  id: id(),
  name: text().notNull(),
  groupName: text().notNull().unique(),
  color: text().notNull().default('#808080'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const FIELD_TYPES = ['string', 'number', 'date', 'hour', 'array'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const fieldType = pgEnum('field_type', FIELD_TYPES);

/** Reusable custom-field definitions. */
export const fields = pgTable('fields', {
  id: id(),
  name: text().notNull(),
  type: fieldType().notNull(),
  createdAt: createdAt(),
});

/** Content ("intel") types: lecture, video, textbook… each with an ordered list of custom fields. */
export const contentTypes = pgTable('content_types', {
  id: id(),
  name: text().notNull().unique(),
  displayName: text().notNull(),
  icon: text(),
  color: text(),
  position: integer().notNull().default(0),
});

export const contentTypeFields = pgTable(
  'content_type_fields',
  {
    contentTypeId: uuid()
      .notNull()
      .references(() => contentTypes.id, { onDelete: 'cascade' }),
    fieldId: uuid()
      .notNull()
      .references(() => fields.id, { onDelete: 'restrict' }),
    required: boolean().notNull().default(false),
    position: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.contentTypeId, t.fieldId] })],
);

/** Reusable labels (autocomplete + classification). Labels have no viewing permissions. */
export const labels = pgTable('labels', {
  id: id(),
  name: text().notNull().unique(),
  createdAt: createdAt(),
});
