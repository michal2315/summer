import { Params } from '@angular/router';
import { IQueryGroup, ISummarySearch, SearchType, SortKey } from '../../shared/models';
import { countConditions } from './advanced-search/query-tree';

/** Search state ⇄ URL query params, so searches are linkable, survive reloads and work with back/forward. */
const KEYS = {
  text: 'q',
  searchTypes: 'in',
  contentTypes: 'types',
  colors: 'colors',
  users: 'users',
  labels: 'labels',
  collections: 'collections',
  dates: 'event',
  createdDates: 'created',
  sort: 'sort',
  query: 'adv',
} as const;

export const SEARCH_PARAM_KEYS: string[] = Object.values(KEYS);

export const DEFAULT_SORT: SortKey = '-eventDate';

const list = (v: string | undefined) => (v ? v.split(',').filter(Boolean) : undefined);
const join = (v: string[] | undefined) => (v?.length ? v.join(',') : null);

/** A hand-edited or truncated `adv` param is dropped rather than breaking the page. */
function parseTree(v: string | undefined): IQueryGroup | undefined {
  if (!v) return undefined;
  try {
    const tree = JSON.parse(v);
    return tree?.type === 'group' && Array.isArray(tree.children) ? tree : undefined;
  } catch {
    return undefined;
  }
}

export function searchFromParams(p: Params): ISummarySearch {
  return {
    text: p[KEYS.text] || undefined,
    searchTypes: list(p[KEYS.searchTypes]) as SearchType[] | undefined,
    contentTypes: list(p[KEYS.contentTypes]),
    colors: list(p[KEYS.colors])?.map((c) => (c.startsWith('#') ? c : `#${c}`)),
    users: list(p[KEYS.users]),
    labels: list(p[KEYS.labels]),
    collections: list(p[KEYS.collections]),
    dates: list(p[KEYS.dates]),
    createdDates: list(p[KEYS.createdDates]),
    sort: (p[KEYS.sort] as SortKey) || undefined,
    query: parseTree(p[KEYS.query]),
  };
}

/** Returns a full patch (null clears a key) for router.navigate({ queryParams, queryParamsHandling: 'merge' }). */
export function searchToParams(s: ISummarySearch): Params {
  return {
    [KEYS.text]: s.text?.trim() || null,
    [KEYS.searchTypes]: join(s.searchTypes),
    [KEYS.contentTypes]: join(s.contentTypes),
    [KEYS.colors]: join(s.colors?.map((c) => c.replace('#', ''))),
    [KEYS.users]: join(s.users),
    [KEYS.labels]: join(s.labels),
    [KEYS.collections]: join(s.collections),
    [KEYS.dates]: join(s.dates),
    [KEYS.createdDates]: join(s.createdDates),
    [KEYS.sort]: s.sort && s.sort !== DEFAULT_SORT ? s.sort : null,
    [KEYS.query]: s.query && countConditions(s.query) ? JSON.stringify(s.query) : null,
  };
}

/** Number of active advanced filters (badge on the search box). */
export function activeFilterCount(s: ISummarySearch): number {
  const lists = [s.searchTypes, s.contentTypes, s.colors, s.users, s.labels, s.collections, s.dates, s.createdDates].filter((v) => v?.length).length;
  return lists + (s.query ? countConditions(s.query) : 0);
}
