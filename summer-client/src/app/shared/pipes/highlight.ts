import { ICapsule, IQueryGroup, ISummarySearch, QueryTextField, SearchType } from '../models';
import { capsuleTokenId, isCapsuleToken, positiveWords } from '../utils/capsules';
import { foldPattern } from '../utils/fold';
import { QueryTerm, parseQuery } from '../utils/search-syntax';

/** Capsules already fetched (CapsuleService); an unknown #name highlights as the plain word, like the server searches it. */
export interface CapsuleResolver {
  byName(name: string): ICapsule | undefined;
  byId(id: string): ICapsule | undefined;
}

const capsuleTerms = (c: ICapsule): QueryTerm[] => positiveWords(c).map((term) => ({ term, neg: false, exact: false }));

/** A term as regex source: literal, with foldable characters widened (utils/fold.ts). */
const termPattern = (s: string) => foldPattern(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Search text → match regex over the terms that must appear (not negated ones, operators, @users, :type: / :color:).
 * With `scope`, plain terms count only when `plain` and `:field:` terms only for that field.
 * Words are matched anywhere; "quoted text" is a whole-word exact match; a #capsule stands for its must and optional words.
 * Uses Unicode letter classes because \b does not understand Hebrew.
 */
export function searchRegex(
  text: string | undefined,
  extra: QueryTerm[] = [],
  capsules?: CapsuleResolver,
  scope?: { field: QueryTextField | undefined; plain: boolean },
): RegExp | null {
  const applies = (t: QueryTerm) =>
    t.field === 'author' || t.field === 'type' || t.field === 'color' ? false : t.field ? !scope || scope.field === t.field : !scope || scope.plain;
  const typed = (text?.trim() ? parseQuery(text).groups.flat() : []).filter((t) => !t.neg && applies(t));
  const terms = [
    ...typed.flatMap((t) => {
      const c = t.capsule ? capsules?.byName(t.term) : undefined;
      return c ? capsuleTerms(c) : [t];
    }),
    ...extra,
  ];
  const parts = terms
    .filter((t) => !t.neg)
    .map((t) => (t.exact ? `(?<![\\p{L}\\p{N}])${termPattern(t.term)}(?![\\p{L}\\p{N}])` : termPattern(t.term)));
  if (!parts.length) return null;
  // Longest first so overlapping terms prefer the longer match.
  parts.sort((a, b) => b.length - a.length);
  return new RegExp(parts.join('|'), 'giu');
}

const TYPE_FIELD: Partial<Record<SearchType, QueryTextField>> = {
  [SearchType.Title]: 'title',
  [SearchType.Content]: 'content',
  [SearchType.Label]: 'labels',
  [SearchType.Notes]: 'notes',
  [SearchType.Comments]: 'comments',
};

/** Words the advanced search requires in this field ("anywhere" conditions count for every field). */
function queryWords(q: IQueryGroup | undefined, field: QueryTextField | undefined, capsules?: CapsuleResolver): QueryTerm[] {
  if (!q) return [];
  const word = (w: string): QueryTerm[] => {
    if (!isCapsuleToken(w)) return [{ term: w, neg: false, exact: false }];
    const c = capsules?.byId(capsuleTokenId(w));
    return c ? capsuleTerms(c) : [];
  };
  return q.children.flatMap((c) =>
    c.type === 'group' ? queryWords(c, field, capsules) : c.op !== 'none' && (c.field === 'text' || c.field === field) ? (c.words ?? []).flatMap(word) : [],
  );
}

/** Highlight only fields whose search type is checked (no types selected ⇒ all), plus :field: terms and the advanced search's words for the field. */
export function regexFor(search: ISummarySearch | null | undefined, type: SearchType, capsules?: CapsuleResolver): RegExp | null {
  if (!search) return null;
  const textApplies = !search.searchTypes?.length || search.searchTypes.includes(type);
  return searchRegex(search.text, queryWords(search.query, TYPE_FIELD[type], capsules), capsules, { field: TYPE_FIELD[type], plain: textApplies });
}

/** Plain text → escaped HTML with <span class="highlight"> around hits. */
export function highlightText(text: string, re: RegExp | null): string {
  if (!text) return '';
  if (!re) return escapeHtml(text);
  let out = '';
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (!m[0]) continue;
    out += escapeHtml(text.slice(last, m.index)) + `<span class="highlight">${escapeHtml(m[0])}</span>`;
    last = m.index! + m[0].length;
  }
  return out + escapeHtml(text.slice(last));
}

/** Already-sanitized HTML → same HTML with hits wrapped. Walks text nodes only, so tags/attributes are never touched. */
export function highlightHtml(html: string, re: RegExp | null): string {
  if (!html || !re) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const text = node.data;
    re.lastIndex = 0;
    if (!re.test(text)) continue;
    re.lastIndex = 0;
    const frag = doc.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(re)) {
      if (!m[0]) continue;
      frag.append(text.slice(last, m.index));
      const span = doc.createElement('span');
      span.className = 'highlight';
      span.textContent = m[0];
      frag.append(span);
      last = m.index! + m[0].length;
    }
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
  return doc.body.innerHTML;
}

/**
 * The first hit in `text` with some words around it, as escaped HTML with the hits wrapped; null when nothing matches.
 * `before` / `after`: about how many characters of context to keep (cut at a space).
 */
export function matchSnippet(text: string, re: RegExp | null, before = 40, after = 70): string | null {
  if (!text || !re) return null;
  re.lastIndex = 0;
  const m = re.exec(text);
  re.lastIndex = 0;
  if (!m || !m[0]) return null;
  let start = Math.max(0, m.index - before);
  let end = Math.min(text.length, m.index + m[0].length + after);
  if (start > 0) start = text.indexOf(' ', start) + 1 || start;
  if (start > m.index) start = m.index;
  if (end < text.length) end = Math.max(text.lastIndexOf(' ', end), m.index + m[0].length);
  return (start > 0 ? '…' : '') + highlightText(text.slice(start, end).trim(), re) + (end < text.length ? '…' : '');
}
