import { ISummarySearch, SearchType } from '../models';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Search text → match regex. Words are space-split and matched anywhere; "quoted text" is a whole-word exact match.
 * Uses Unicode letter classes because \b does not understand Hebrew.
 */
export function searchRegex(text: string | undefined): RegExp | null {
  if (!text?.trim()) return null;
  const parts: string[] = [];
  const rest = text.replace(/"([^"]+)"/g, (_, phrase: string) => {
    parts.push(`(?<![\\p{L}\\p{N}])${escapeRegex(phrase.trim())}(?![\\p{L}\\p{N}])`);
    return ' ';
  });
  for (const word of rest.split(/\s+/)) if (word) parts.push(escapeRegex(word.replace(/^#/, '')));
  if (!parts.length) return null;
  // Longest first so overlapping terms prefer the longer match.
  parts.sort((a, b) => b.length - a.length);
  return new RegExp(parts.join('|'), 'giu');
}

/** Highlight only fields whose search type is checked (no types selected ⇒ all). */
export function regexFor(search: ISummarySearch | null | undefined, type: SearchType): RegExp | null {
  if (!search?.text) return null;
  if (search.searchTypes?.length && !search.searchTypes.includes(type)) return null;
  return searchRegex(search.text);
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
