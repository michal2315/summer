import { z } from 'zod';
import { dayToInstant } from './format';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use yyyy-MM-dd');
const id = z.string().uuid();

/** Filters a saved query can keep (Summer stores only these on a query). */
export const queryFiltersShape = {
  text: z
    .string()
    .max(200)
    .optional()
    .describe('Words to find. Every word must appear (in any of the `searchIn` parts). Use "quotes" for an exact phrase.'),
  searchIn: z
    .array(z.enum(['title', 'content', 'notes', 'labels', 'comments']))
    .optional()
    .describe('Which parts `text` is matched against. Default: all of them.'),
  capsuleIds: z.array(z.string()).max(10).optional().describe('Capsules (shared word lists, from find_capsules) the summaries must match. All must match.'),
  eventFrom: day.optional().describe('Event date from (yyyy-MM-dd, inclusive).'),
  eventTo: day.optional().describe('Event date to (yyyy-MM-dd, inclusive).'),
  createdFrom: day.optional().describe('Created from (yyyy-MM-dd, inclusive).'),
  createdTo: day.optional().describe('Created to (yyyy-MM-dd, inclusive).'),
  authorIds: z.array(id).max(50).optional().describe('Written by any of these users (ids from find_users).'),
  labels: z.array(z.string()).max(50).optional().describe('Has any of these labels (exact label names, see get_catalog).'),
  contentTypes: z.array(z.string()).max(50).optional().describe('Of any of these content types (content type `name`, see get_catalog).'),
  folderIds: z.array(id).max(50).optional().describe('Placed in any of these folders or their subfolders (ids from list_folders).'),
};

/** Filters that only a live search takes. */
export const extraFiltersShape = {
  department: z.string().max(200).optional().describe('Only summaries of this department (exact).'),
  unfiledOnly: z.boolean().optional().describe('Only summaries that are in no folder.'),
  kinds: z
    .array(z.enum(['summary', 'running', 'sumaroon']))
    .optional()
    .describe('Only these kinds: summary (regular), running (a running summary over a date range) or sumaroon (an entry inside a running summary). Default: all.'),
  runningSummaryId: id.optional().describe('Only the sumaroons of this running summary.'),
};

export const SORTS = ['eventDate', '-eventDate', 'creationDate', '-creationDate', 'modifyDate', '-modifyDate', 'title', '-title'] as const;
export const sortSchema = z.enum(SORTS).describe('Sort key; a leading "-" means newest/descending first. Default: -eventDate.');

export const BUCKETS = { published: 'SUMMARY', myDrafts: 'DRAFT', taggedMe: 'TAGGED', myFavorites: 'FAVORITE' } as const;
export type BucketName = keyof typeof BUCKETS;
export const BUCKET_LENGTH: Record<BucketName, 'summary' | 'draft' | 'tagged' | 'favorite'> = {
  published: 'summary',
  myDrafts: 'draft',
  taggedMe: 'tagged',
  myFavorites: 'favorite',
};

type QueryFilters = z.infer<z.ZodObject<typeof queryFiltersShape>>;
type ExtraFilters = z.infer<z.ZodObject<typeof extraFiltersShape>>;

const range = (from?: string, to?: string): string[] | undefined =>
  from || to ? [dayToInstant(from ?? '1900-01-01'), dayToInstant(to ?? '2999-12-31')] : undefined;

const nonEmpty = <T>(xs?: T[]): T[] | undefined => (xs && xs.length ? xs : undefined);

/** Tool filters → Summer's search object (the shape the feed takes and a query stores). */
export function toSummerSearch(f: QueryFilters & Partial<ExtraFilters>): Record<string, unknown> {
  const capsules = nonEmpty(f.capsuleIds);
  return Object.fromEntries(
    Object.entries({
      text: f.text?.trim() || undefined,
      searchTypes: nonEmpty(f.searchIn?.map((s) => s.toUpperCase())),
      dates: range(f.eventFrom, f.eventTo),
      createdDates: range(f.createdFrom, f.createdTo),
      users: nonEmpty(f.authorIds),
      labels: nonEmpty(f.labels),
      contentTypes: nonEmpty(f.contentTypes),
      folders: nonEmpty(f.folderIds),
      // A capsule is matched through the advanced-search tree, where it is written `#cap:<id>`.
      query: capsules
        ? { type: 'group', op: 'AND', children: capsules.map((c) => ({ type: 'cond', field: 'text', op: 'all', words: [`#cap:${c}`], values: [] })) }
        : undefined,
      department: f.department || undefined,
      noFolder: f.unfiledOnly || undefined,
      kinds: nonEmpty(f.kinds),
      parentId: f.runningSummaryId,
    }).filter(([, v]) => v !== undefined),
  );
}

/** A Summer search object → GET query params (lists repeated, the advanced tree as JSON). */
export function toQueryParams(search: Record<string, unknown>): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(search)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) out[k] = v.map(String);
    else if (typeof v === 'object') out[k] = JSON.stringify(v);
    else out[k] = String(v);
  }
  return out;
}
