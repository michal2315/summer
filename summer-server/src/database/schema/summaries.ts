import { AnyPgColumn, boolean, check, date, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { contentTypes, fields, labels, permissions } from './catalog';
import { createdAt, id, updatedAt } from './columns';
import { users } from './users';

export interface Mention {
  _id: string;
  type: 'user' | 'label';
  value: string;
  icon?: string;
}

/**
 * summary = a regular summary; running = a תמצית רצף (series header with a date range); sumaroon = a תמציתונית,
 * one entry of exactly one running summary. All three are summaries (feed, search, comments, files…).
 */
export const SUMMARY_KINDS = ['summary', 'running', 'sumaroon'] as const;
export type SummaryKind = (typeof SUMMARY_KINDS)[number];
export const summaryKind = pgEnum('summary_kind', SUMMARY_KINDS);

export const summaries = pgTable(
  'summaries',
  {
    id: id(),
    title: text().notNull(),
    /** Sanitized Quill HTML. */
    contentHtml: text().notNull().default(''),
    /** Plain-text projection of contentHtml, maintained by the server for search. */
    contentText: text().notNull().default(''),
    notesHtml: text().notNull().default(''),
    notesText: text().notNull().default(''),
    department: text().notNull().default(''),
    contentTypeId: uuid()
      .notNull()
      .references(() => contentTypes.id, { onDelete: 'restrict' }),
    isDraft: boolean().notNull().default(false),
    /** Event date (+ time when eventHasTime) as an instant; entered as wall-clock time in APP_TIMEZONE. */
    eventDate: timestamp({ withTimezone: true }),
    eventHasTime: boolean().notNull().default(false),
    /** Card highlight colour; '' = none. Shared by all viewers (matches the existing client). */
    color: text().notNull().default(''),
    timelineTitle: text(),
    kind: summaryKind().notNull().default('summary'),
    /** sumaroon → its running summary (required; deleting the running summary deletes its sumaroons). */
    parentId: uuid().references((): AnyPgColumn => summaries.id, { onDelete: 'cascade' }),
    /** running only: the series' calendar-day range (APP_TIMEZONE); sumaroon event dates must fall inside it. */
    rangeStart: date({ mode: 'string' }),
    rangeEnd: date({ mode: 'string' }),
    /** sumaroon only: source link. */
    link: text(),
    createdBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Optimistic-concurrency version, bumped on every meaningful change. */
    version: integer().notNull().default(1),
  },
  (t) => [
    index('summaries_feed_idx').on(t.createdAt.desc(), t.id.desc()),
    index('summaries_event_idx').on(t.eventDate.desc(), t.id.desc()),
    index('summaries_author_idx').on(t.createdBy, t.createdAt.desc()),
    index('summaries_content_type_idx').on(t.contentTypeId),
    index('summaries_title_trgm').using('gin', t.title.op('gin_trgm_ops')),
    index('summaries_content_trgm').using('gin', t.contentText.op('gin_trgm_ops')),
    index('summaries_notes_trgm').using('gin', t.notesText.op('gin_trgm_ops')),
    index('summaries_parent_idx').on(t.parentId),
    check('summaries_sumaroon_has_parent', sql`(${t.kind} = 'sumaroon') = (${t.parentId} is not null)`),
    check(
      'summaries_range_only_running',
      sql`case when ${t.kind} = 'running' then ${t.rangeStart} is not null and ${t.rangeEnd} is not null and ${t.rangeStart} <= ${t.rangeEnd}
               else ${t.rangeStart} is null and ${t.rangeEnd} is null end`,
    ),
    check('summaries_link_only_sumaroon', sql`${t.kind} = 'sumaroon' or ${t.link} is null`),
  ],
);

const summaryFk = () =>
  uuid()
    .notNull()
    .references(() => summaries.id, { onDelete: 'cascade' });
const userFk = () =>
  uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });

/** Viewing requirements: a viewer must hold EVERY listed permission. Published summaries need at least one (trigger). */
export const summaryPermissions = pgTable(
  'summary_permissions',
  {
    summaryId: summaryFk(),
    permissionId: uuid()
      .notNull()
      .references(() => permissions.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.summaryId, t.permissionId] }), index().on(t.permissionId)],
);

/** Users allowed to edit. The creator is added on create. Editing also requires viewing access. */
export const summaryEditors = pgTable(
  'summary_editors',
  {
    summaryId: summaryFk(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.summaryId, t.userId] }), index().on(t.userId)],
);

export const summaryLabels = pgTable(
  'summary_labels',
  {
    summaryId: summaryFk(),
    labelId: uuid()
      .notNull()
      .references(() => labels.id, { onDelete: 'restrict' }),
    /** Client order; the first label groups the dashboard. */
    position: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.summaryId, t.labelId] }), index().on(t.labelId)],
);

/** Custom-field values, validated against the field definition on write. */
export const summaryFields = pgTable(
  'summary_fields',
  {
    summaryId: summaryFk(),
    fieldId: uuid()
      .notNull()
      .references(() => fields.id, { onDelete: 'restrict' }),
    value: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.summaryId, t.fieldId] }), index().on(t.fieldId, t.value)],
);

export const summaryTaggedUsers = pgTable(
  'summary_tagged_users',
  { summaryId: summaryFk(), userId: userFk() },
  (t) => [primaryKey({ columns: [t.summaryId, t.userId] }), index().on(t.userId)],
);

export const summarySeen = pgTable(
  'summary_seen',
  { summaryId: summaryFk(), userId: userFk(), seenAt: createdAt() },
  (t) => [primaryKey({ columns: [t.summaryId, t.userId] })],
);

/** Attachment metadata; the bytes live under UPLOAD_DIR/<summaryId>/. */
export const summaryFiles = pgTable(
  'summary_files',
  {
    summaryId: summaryFk(),
    fileName: text().notNull(),
    size: integer().notNull(),
    mimeType: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.summaryId, t.fileName] })],
);

export const comments = pgTable(
  'comments',
  {
    id: id(),
    summaryId: summaryFk(),
    content: text().notNull(),
    mentions: jsonb().$type<Mention[]>().notNull().default([]),
    createdBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.summaryId, t.createdAt), index('comments_content_trgm').using('gin', t.content.op('gin_trgm_ops'))],
);
