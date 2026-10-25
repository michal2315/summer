import { sql } from 'drizzle-orm';
import { boolean, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './columns';

/** One row per verified identity. Groups are NOT stored here: they are resolved from the identity provider per request. */
export const users = pgTable(
  'users',
  {
    id: id(),
    authIssuer: text().notNull(),
    authSubject: text().notNull(),
    username: text().notNull().unique(),
    fullName: text().notNull(),
    department: text().notNull().default(''),
    email: text(),
    /** The built-in "Summer" account. */
    isSystem: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    /**
     * Last group keys the identity provider reported. A cache, not an authority: used only to pre-filter
     * notifications for other users; every read re-authorizes with fresh groups.
     */
    lastGroupKeys: text().array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique().on(t.authIssuer, t.authSubject)],
);
