import { IQueryGroup, ISummarySearch, QueryTextField, SearchType } from '../models';
import { QueryTerm, parseQuery } from '../utils/search-syntax';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Search text → match regex over the terms that must appear (not negated ones, operators, @users or :types).
 * Words are matched anywhere; "quoted text" is a whole-word exact match.
 * Uses Unicode letter classes because \b does not understand Hebrew.
 */
export function searchRegex(text: string | undefined, extra: QueryTerm[] = []): RegExp | null {
  const terms = [...(text?.trim() ? parseQuery(text).groups.flat() : []), ...extra];
  const parts = terms
    .filter((t) => !t.neg)
    .map((t) => (t.exact ? `(?<![\\p{L}\\p{N}])${escapeRegex(t.term)}(?![\\p{L}\\p{N}])` : escapeRegex(t.term)));
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
function queryWords(q: IQueryGroup | undefined, field: QueryTextField | undefined): QueryTerm[] {
  if (!q) return [];
  return q.children.flatMap((c) =>
    c.type === 'group'
      ? queryWords(c, field)
      : c.op !== 'none' && (c.field === 'text' || c.field === field)
        ? (c.words ?? []).map((term) => ({ term, neg: false, exact: false }))
        : [],
  );
}

/** Highlight only fields whose search type is checked (no types selected ⇒ all), plus the advanced search's words for the field. */
export function regexFor(search: ISummarySearch | null | undefined, type: SearchType): RegExp | null {
  if (!search) return null;
  const textApplies = !search.searchTypes?.length || search.searchTypes.includes(type);
  return searchRegex(textApplies ? search.text : undefined, queryWords(search.query, TYPE_FIELD[type]));
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
