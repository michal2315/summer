import { BadRequestException } from '@nestjs/common';
import { summarySearchSchema } from '../summaries/summary-search';

/** The parts of a search that select summaries (paging, sort and buckets don't apply to an alert). */
export const SEARCH_KEYS = ['text', 'searchTypes', 'contentTypes', 'colors', 'users', 'labels', 'folders', 'dates', 'createdDates', 'query'];
/** What a query keeps: the selecting parts and its own sort. */
const STORED_KEYS = [...SEARCH_KEYS, 'sort'];
const MAX_SEARCH_BYTES = 8192;

const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);

/** The selecting part of a search, empty values dropped. */
export const alertPart = (search: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(search).filter(([k, v]) => SEARCH_KEYS.includes(k) && !isEmpty(v)));

/** Order-insensitive identity of what a search selects (two queries that find the same summaries have one key). */
export function searchKey(search: Record<string, unknown>): string {
  const norm = Object.entries(alertPart(search))
    .map(([k, v]) => [k, Array.isArray(v) ? [...v].map(String).sort() : typeof v === 'string' ? v.trim() : v] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(norm);
}

/**
 * A query's search from a request: only the stored keys, size-checked, valid as a feed search, and selecting
 * something (a query that finds everything is no query).
 */
export function cleanSearch(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('search must be an object');
  const search = Object.fromEntries(Object.entries(raw).filter(([k, v]) => STORED_KEYS.includes(k) && !isEmpty(v)));
  if (JSON.stringify(search).length > MAX_SEARCH_BYTES) throw new BadRequestException('search too large');
  if (!summarySearchSchema.safeParse(search).success) throw new BadRequestException('invalid search');
  if (!Object.keys(alertPart(search)).length) throw new BadRequestException('search is empty');
  return search;
}
