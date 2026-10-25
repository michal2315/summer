import { z } from 'zod';
import { zBoolString, zId, zList } from '../common/validation';
import { SUMMARY_KINDS } from '../database/schema';

export const SEARCH_TYPES = ['TITLE', 'LABEL', 'CONTENT', 'NOTES', 'COMMENTS', 'COLOR'] as const;
export const BUCKETS = ['SUMMARY', 'DRAFT', 'TAGGED', 'FAVORITE'] as const;
export const SORT_KEYS = ['eventDate', '-eventDate', 'creationDate', '-creationDate', 'modifyDate', '-modifyDate', 'title', '-title'] as const;

export const MAX_PAGE = 100;

/** ISummarySearch from the client, as query params (feed/collection) or JSON (Excel export). Unknown keys are dropped. */
export const summarySearchSchema = z.object({
  text: z.string().max(200).default(''),
  searchTypes: zList.pipe(z.array(z.enum(SEARCH_TYPES))),
  dates: zList,
  createdDates: zList,
  sort: z.enum(SORT_KEYS).default('-eventDate'),
  skip: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE).default(20),
  users: zList.pipe(z.array(zId)),
  department: z.string().max(200).optional(),
  summarySearch: z.enum(BUCKETS).default('SUMMARY'),
  isProfile: zBoolString,
  contentTypes: zList,
  colors: zList,
  labels: zList,
  collections: zList.pipe(z.array(zId)),
  /** only these kinds (summary | running | sumaroon); empty = all */
  kinds: zList.pipe(z.array(z.enum(SUMMARY_KINDS))),
  /** the sumaroons of this running summary */
  parentId: zId.optional(),
});

export type SummarySearch = z.output<typeof summarySearchSchema>;
export type Bucket = (typeof BUCKETS)[number];

const MAX_TERMS = 10;

/**
 * Query text → terms, all of which must match (AND), like the existing client mock: "quoted phrases" stay whole,
 * other words split on whitespace, a leading # (hashtag) is ignored. Matching is case-insensitive substring.
 */
export function searchTerms(text: string): string[] {
  const phrases = [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim());
  const words = text
    .replace(/"[^"]*"/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^#/, ''));
  return [...new Set([...phrases, ...words].filter(Boolean))].slice(0, MAX_TERMS);
}
