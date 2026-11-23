import { CapsuleLookup, capsuleTokenId, isCapsuleToken, wordsOf } from '../capsules/capsule';
import { escapeHtml } from '../common/html';
import { foldText, regexProblem } from '../common/sql';
import { zonedDate } from '../common/time';
import { QueryCondition, QueryGroup, QueryTerm, SummarySearch, colorLabel, parseQuery } from '../summaries/summary-search';

/**
 * What an alert is about, for the people it notifies: its search in words ("why"), and the words it looks for as
 * patterns, to say which of them the summary has ("found") and to highlight them in e-mails.
 */

/** Display names for what a search holds as ids or names. Unknown ones fall back to the raw value. */
export interface SearchNames {
  users: Map<string, string>;
  folders: Map<string, string>;
  /** content type name → display name */
  contentTypes: Map<string, string>;
  /** catalog field id → name */
  fields: Map<string, string>;
  capsules: CapsuleLookup;
}

/** The ids and names a search refers to (what SearchNames must hold). */
export function searchRefs(s: SummarySearch): { userIds: string[]; folderIds: string[]; contentTypes: string[]; fieldIds: string[] } {
  const refs = { userIds: [...s.users], folderIds: [...s.folders], contentTypes: [...s.contentTypes], fieldIds: [] as string[] };
  const walk = (g: QueryGroup) =>
    g.children.forEach((c) => {
      if (c.type === 'group') return walk(c);
      if (c.field === 'author') refs.userIds.push(...c.values);
      if (c.field === 'folder') refs.folderIds.push(...c.values);
      if (c.field === 'contentType') refs.contentTypes.push(...c.values);
      if (c.field === 'field' && c.fieldId) refs.fieldIds.push(c.fieldId);
    });
  if (s.query) walk(s.query);
  return refs;
}

// ---------------------------------------------------------------- the search in words

const FIELD_IN: Record<string, string> = { title: 'בכותרת', content: 'בתוכן', notes: 'בהערות', comments: 'בתגובות', labels: 'בתגיות' };
const KIND_NAMES: Record<string, string> = { summary: 'תמצית', running: 'תמצית רצף', sumaroon: 'תמציתונית' };
const join = (items: string[], sep = ' / ') => items.join(sep);
const quote = (s: string) => `"${s}"`;

function day(iso: string | undefined, timeZone: string): string {
  if (!iso) return '…';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '…';
  const [y, m, dd] = zonedDate(d, timeZone);
  return `${dd}/${m}/${y}`;
}

function termText(t: QueryTerm, names: SearchNames): string {
  const name = (map: Map<string, string>, v: string) => map.get(v) ?? v;
  let s: string;
  if (t.field === 'author') s = `מאת ${t.term}`;
  else if (t.field === 'type') s = `מסוג ${t.regex ? `/${t.term}/` : name(names.contentTypes, t.term)}`;
  else if (t.field === 'color') s = `בצבע ${t.regex ? `/${t.term}/` : colorLabel(t.term)}`;
  else {
    const word = t.regex ? `/${t.term}/` : t.capsule ? `#${names.capsules.byName(t.term)?.name ?? t.term}` : quote(t.term);
    s = t.field ? `${word} ${FIELD_IN[t.field]}` : word;
  }
  return t.neg ? `בלי ${s}` : s;
}

function conditionText(c: QueryCondition, names: SearchNames, timeZone: string): string {
  const fieldName = c.field === 'field' ? `השדה "${names.fields.get(c.fieldId ?? '') ?? 'שדה'}"` : '';
  const where = c.field === 'field' ? ` ב${fieldName}` : c.field !== 'text' && FIELD_IN[c.field] ? ` ${FIELD_IN[c.field]}` : '';
  const word = (w: string) => (isCapsuleToken(w) ? `#${names.capsules.byId(capsuleTokenId(w))?.name ?? 'כמוסה'}` : quote(w));
  const words = c.words.filter(Boolean);
  switch (c.op) {
    case 'all':
      return `מכילות ${join(words.map(word), ' + ')}${where}`;
    case 'any':
      return `מכילות אחת מ־${join(words.map(word))}${where}`;
    case 'none':
      return `לא מכילות ${join(words.map(word))}${where}`;
    case 'regex':
      return `תואמות ${join(
        words.map((w) => `/${w}/`),
        ' או ',
      )}${where}`;
  }
  const values = (v: string) =>
    c.field === 'author' ? (names.users.get(v) ?? v) : c.field === 'folder' ? (names.folders.get(v) ?? v) : c.field === 'contentType' ? (names.contentTypes.get(v) ?? v) : c.field === 'color' ? colorLabel(v) : quote(v);
  const VALUE_LEADS: Record<string, [string, string]> = {
    author: ['שנכתבו על ידי', 'שלא נכתבו על ידי'],
    contentType: ['מסוג', 'שאינן מסוג'],
    folder: ['בתיקייה', 'שאינן בתיקייה'],
    color: ['בצבע', 'שאינן בצבע'],
  };
  if (c.op === 'isOneOf' || c.op === 'isNot') {
    if (c.field === 'field') return `ש${fieldName} ${c.op === 'isNot' ? 'לא כולל' : 'כולל אחד מ־'} ${join(c.values.map(values))}`;
    const [yes, no] = VALUE_LEADS[c.field];
    return `${c.op === 'isNot' ? no : yes} ${join(c.values.map(values))}`;
  }
  const subject = c.field === 'eventDate' ? 'שהאירוע שלהן' : c.field === 'createdDate' ? 'שנכתבו' : `ש${fieldName}`;
  const isDate = c.field !== 'field' || ['after', 'before', 'between'].includes(c.op);
  const v = (x: string | undefined) => (isDate ? day(x, timeZone) : x?.trim() || '…');
  switch (c.op) {
    case 'after':
      return `${subject} אחרי ${v(c.from)}`;
    case 'before':
      return `${subject} לפני ${v(c.to)}`;
    case 'eq':
      return `${subject} שווה ל־${v(c.from)}`;
    case 'gt':
      return `${subject} גדול מ־${v(c.from)}`;
    case 'lt':
      return `${subject} קטן מ־${v(c.to)}`;
    default:
      return `${subject} בין ${v(c.from)} ל־${v(c.to)}`;
  }
}

function groupText(g: QueryGroup, names: SearchNames, timeZone: string, depth = 0): string {
  const parts = g.children.map((c) => (c.type === 'group' ? groupText(c, names, timeZone, depth + 1) : conditionText(c, names, timeZone)));
  const s = parts.join(g.op === 'AND' ? ' וגם ' : ' או ');
  return depth > 0 && parts.length > 1 ? `(${s})` : s;
}

/** The search as short Hebrew phrases, each one thing the alert asks for ("מכילות "רמב"ם"", "מסוג הרצאה"). */
export function describeSearch(s: SummarySearch, names: SearchNames, timeZone: string): string[] {
  const out: string[] = [];
  const groups = parseQuery(s.text).groups;
  if (groups.length) {
    const text = groups.map((g) => g.map((t) => termText(t, names)).join(' וגם ')).join(' או ');
    out.push(`תואמות לחיפוש ${text}`);
  }
  if (s.query?.children.length) out.push(groupText(s.query, names, timeZone));
  if (s.contentTypes.length) out.push(`מסוג ${join(s.contentTypes.map((t) => names.contentTypes.get(t) ?? t))}`);
  if (s.labels.length) out.push(`עם התגית ${join(s.labels.map((l) => `#${l}`))}`);
  if (s.colors.length) out.push(`בצבע ${join(s.colors.map(colorLabel))}`);
  if (s.users.length) out.push(`שנכתבו על ידי ${join(s.users.map((u) => names.users.get(u) ?? u))}`);
  if (s.folders.length) out.push(`בתיקייה ${join(s.folders.map((f) => quote(names.folders.get(f) ?? f)))} (כולל תתי־תיקיות)`);
  if (s.noFolder) out.push('שאינן באף תיקייה');
  if (s.kinds.length) out.push(`מסוג ${join(s.kinds.map((k) => KIND_NAMES[k] ?? k))}`);
  if (s.dates.length === 2) out.push(`שהאירוע שלהן בין ${day(s.dates[0], timeZone)} ל־${day(s.dates[1], timeZone)}`);
  if (s.createdDates.length === 2) out.push(`שנכתבו בין ${day(s.createdDates[0], timeZone)} ל־${day(s.createdDates[1], timeZone)}`);
  return out;
}

// ---------------------------------------------------------------- the words it looks for

/** Where a highlight is looked for: anywhere the mail shows text, or one field. */
export type HighlightWhere = 'any' | 'title' | 'content' | 'labels';

export interface Highlight {
  /** As the alert has it: a word, "a phrase", /a regex/. */
  label: string;
  where: HighlightWhere;
  /** Global, Unicode, case-insensitive; runs on foldText(text) (same length, so indices hold). */
  re: RegExp;
}

const WORD = String.raw`\p{L}\p{N}_`;
const JS_BOUNDARY = `(?:(?<=[${WORD}])(?![${WORD}])|(?<![${WORD}])(?=[${WORD}]))`;
const JS_NON_BOUNDARY = `(?:(?<=[${WORD}])(?=[${WORD}])|(?<![${WORD}])(?![${WORD}]))`;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A search regex as JavaScript (Unicode mode, run on foldText()ed text), \b \B \w \W knowing Hebrew like the SQL (pgRegex); null when it can't be. */
export function jsRegex(pattern: string): string | null {
  if (regexProblem(pattern)) return null;
  let out = '';
  let inClass = false;
  let classStart = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    const wasStart = classStart;
    classStart = false;
    if (c === '\\' && i + 1 < pattern.length) {
      const n = pattern[++i];
      if (inClass) out += n === 'w' ? WORD : `\\${n}`;
      else out += n === 'b' ? JS_BOUNDARY : n === 'B' ? JS_NON_BOUNDARY : n === 'w' ? `[${WORD}]` : n === 'W' ? `[^${WORD}]` : `\\${n}`;
      continue;
    }
    if (!inClass && c === '[') {
      inClass = classStart = true;
      out += pattern[i + 1] === '^' ? '[' + pattern[++i] : '[';
      continue;
    }
    if (inClass && c === ']' && !wasStart) inClass = false;
    out += inClass && c === ']' ? '\\]' : c;
  }
  try {
    new RegExp(out, 'u');
    return foldText(out);
  } catch {
    return null;
  }
}

function highlight(label: string, source: string | null, where: HighlightWhere): Highlight | undefined {
  if (!source) return undefined;
  try {
    return { label, where, re: new RegExp(source, 'giu') };
  } catch {
    return undefined;
  }
}
const contains = (w: string, where: HighlightWhere) => highlight(w, escapeRe(foldText(w)), where);
const wholeWord = (w: string, where: HighlightWhere) => highlight(quote(w), `(?<![${WORD}])${escapeRe(foldText(w))}(?![${WORD}])`, where);
const capsuleWords = (id: string | undefined, name: string | undefined, capsules: CapsuleLookup, where: HighlightWhere) => {
  const c = id ? capsules.byId(id) : name ? capsules.byName(name) : undefined;
  return c ? [...wordsOf(c, 'must'), ...wordsOf(c, 'optional')].map((w) => contains(w, where)) : name ? [contains(name, where)] : [];
};

const WHERE: Partial<Record<string, HighlightWhere>> = { text: 'any', title: 'title', content: 'content', labels: 'labels' };

/** The words the search looks for (not the ones it excludes), as highlights; fields a mail doesn't show are left out. */
export function searchHighlights(s: SummarySearch, capsules: CapsuleLookup): Highlight[] {
  const out: (Highlight | undefined)[] = [];
  for (const t of parseQuery(s.text).groups.flat()) {
    if (t.neg) continue;
    const where = t.field ? WHERE[t.field] : 'any';
    if (!where) continue;
    if (t.regex) out.push(highlight(`/${t.term}/`, jsRegex(t.term), where));
    else if (t.capsule) out.push(...capsuleWords(undefined, t.term, capsules, where));
    else out.push(t.exact ? wholeWord(t.term, where) : contains(t.term, where));
  }
  const walk = (g: QueryGroup) =>
    g.children.forEach((c) => {
      if (c.type === 'group') return walk(c);
      const where = WHERE[c.field];
      if (!where || c.op === 'none') return;
      for (const w of c.words.filter(Boolean)) {
        if (c.op === 'regex') out.push(highlight(`/${w}/`, jsRegex(w), where));
        else if (isCapsuleToken(w)) out.push(...capsuleWords(capsuleTokenId(w), undefined, capsules, where));
        else if (c.op === 'all' || c.op === 'any') out.push(contains(w, where));
      }
    });
  if (s.query) walk(s.query);
  const seen = new Set<string>();
  return out.filter((h): h is Highlight => !!h && !seen.has(`${h.where}:${h.re.source}`) && !!seen.add(`${h.where}:${h.re.source}`));
}

const applies = (h: Highlight, where: Exclude<HighlightWhere, 'any'>) => h.where === 'any' || h.where === where;

/** [start, end) of every match in `text`, merged where they overlap. */
function ranges(text: string, hs: Highlight[]): [number, number][] {
  const folded = foldText(text);
  const found: [number, number][] = [];
  for (const h of hs) {
    h.re.lastIndex = 0;
    for (const m of folded.matchAll(h.re)) if (m[0].length) found.push([m.index, m.index + m[0].length]);
  }
  found.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of found) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

export interface MatchedText {
  title: string;
  content: string;
  labels: string[];
}

/** The highlights the summary actually has, by label (what to say was found). */
export function foundLabels(hs: Highlight[], s: MatchedText): string[] {
  const has = (h: Highlight, text: string) => {
    h.re.lastIndex = 0;
    return h.re.test(foldText(text));
  };
  return [
    ...new Set(
      hs
        .filter((h) => (applies(h, 'title') && has(h, s.title)) || (applies(h, 'content') && has(h, s.content)) || (applies(h, 'labels') && s.labels.some((l) => has(h, l))))
        .map((h) => h.label),
    ),
  ];
}

export const MARK_STYLE = 'background-color:#fff1a8;color:#01004f;border-radius:3px;padding:0 2px;';

/** `text` as escaped HTML with the matches wrapped in <mark>. */
export function markHtml(text: string, hs: Highlight[], where: Exclude<HighlightWhere, 'any'>): string {
  const rs = ranges(
    text,
    hs.filter((h) => applies(h, where)),
  );
  let out = '';
  let at = 0;
  for (const [a, b] of rs) {
    out += escapeHtml(text.slice(at, a)) + `<mark style="${MARK_STYLE}">${escapeHtml(text.slice(a, b))}</mark>`;
    at = b;
  }
  return out + escapeHtml(text.slice(at));
}

/**
 * About `max` characters of `text` (whitespace collapsed), starting a little before the first match so the excerpt
 * shows why the summary matched; from the start when nothing matches.
 */
export function excerptAround(text: string, hs: Highlight[], max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const first = ranges(
    t,
    hs.filter((h) => applies(h, 'content')),
  )[0];
  let start = first ? Math.max(0, first[0] - Math.floor(max / 4)) : 0;
  if (start > 0) {
    const space = t.lastIndexOf(' ', start);
    start = space > 0 && start - space < 20 ? space + 1 : start;
  }
  const end = Math.min(t.length, start + max);
  return `${start > 0 ? '…' : ''}${t.slice(start, end).trim()}${end < t.length ? '…' : ''}`;
}
