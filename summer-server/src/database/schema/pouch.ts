import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './columns';
import { users } from './users';

export const POUCH_MODES = ['perSummary', 'combined'] as const;
/**
 * How a format fills in summaries: `perSummary` repeats the document's repeat block once per summary between the fixed
 * start and end; `combined` writes the document once, each field showing every summary's value, comma-separated.
 */
export type PouchMode = (typeof POUCH_MODES)[number];

/** Page setup of a format (and of the Word file it makes). */
export interface PouchPage {
  orientation: 'portrait' | 'landscape';
  margins: 'narrow' | 'normal' | 'wide';
}

/**
 * A personal export format ("pouch"): a rich document (Tiptap JSON) with field placeholders, which an export fills with
 * the chosen summaries and turns into a Word file. Private by default. The owner can share it with chosen people
 * (pouch_format_members: to use, or also to edit) and/or with everyone (`isShared`: anyone can find, use and copy it).
 */
export const pouchFormats = pgTable(
  'pouch_formats',
  {
    id: id(),
    ownerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    mode: text().$type<PouchMode>().notNull().default('perSummary'),
    doc: jsonb().$type<Record<string, unknown>>().notNull(),
    page: jsonb().$type<PouchPage>().notNull(),
    isFavorite: boolean().notNull().default(false),
    isShared: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.ownerId, t.createdAt),
    index().on(t.isShared, t.updatedAt),
    check('pouch_formats_mode', sql`${t.mode} in ('perSummary', 'combined')`),
  ],
);

export const POUCH_ROLES = ['viewer', 'editor'] as const;
/** What a person the owner shared a format with may do: use and copy it (viewer), or also change it (editor). */
export type PouchRole = (typeof POUCH_ROLES)[number];

/**
 * People the owner shared a format with, each with a role. They see it under "shared with me" and can export with it;
 * editors may also change its name, mode, page and document. Only the owner shares, picks roles or deletes.
 */
export const pouchFormatMembers = pgTable(
  'pouch_format_members',
  {
    formatId: uuid()
      .notNull()
      .references(() => pouchFormats.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text().$type<PouchRole>().notNull().default('viewer'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.formatId, t.userId] }), index().on(t.userId), check('pouch_format_members_role', sql`${t.role} in ('viewer', 'editor')`)],
);
