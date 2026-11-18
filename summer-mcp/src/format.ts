import { ApiSummary } from './api-types';
import { config } from './config';
import type { SummaryBrief, SummaryFull } from './schemas';

// ---------------------------------------------------------------- dates (Summer's calendar days are in its time zone)

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: config.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** ISO instant → `yyyy-MM-dd` in Summer's time zone. */
export const localDay = (iso: string): string => dayFormat.format(new Date(iso));
/** ISO instant → `HH:mm` in Summer's time zone. */
export const localTime = (iso: string): string => timeFormat.format(new Date(iso));
/** ISO instant → `yyyy-MM-dd HH:mm`, the way people read it. */
export const localDateTime = (iso: string): string => `${localDay(iso)} ${localTime(iso)}`;

/**
 * Summer's search wants each date bound as an instant on the wanted calendar day (it takes that day in its own time
 * zone). Midday UTC lands on the same calendar day in every zone Summer runs in.
 */
export const dayToInstant = (day: string): string => `${day}T12:00:00.000Z`;

// ---------------------------------------------------------------- HTML ⇄ text

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };

/** Summer stores rich text as (Quill) HTML; the AI reads plain text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|pre|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Rich-text tags the editor uses: their presence means the text is already HTML. */
const HTML_TAG = /<\/?(p|br|div|span|strong|b|em|i|u|s|a|ul|ol|li|h[1-6]|blockquote|pre|code)(\s[^>]*)?\/?>/i;

/** Plain text (one paragraph per line) → HTML; HTML is passed through (the server sanitizes it). */
export function toHtml(text: string): string {
  if (HTML_TAG.test(text)) return text;
  return text
    .split(/\r?\n/)
    .map((line) => (line.trim() ? `<p>${escapeHtml(line)}</p>` : '<p><br></p>'))
    .join('');
}

const snippet = (html: string, max = 280): string => {
  const text = htmlToText(html).replace(/\s+/g, ' ');
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

// ---------------------------------------------------------------- summaries

/** A search hit: enough to pick which ones to open. */
export function summaryBrief(s: ApiSummary): SummaryBrief {
  return {
    id: s._id,
    title: s.title,
    kind: s.kind,
    isDraft: s.isDraft || undefined,
    eventDate: s.eventDate ? (s.eventSecTime ? localDateTime(s.eventDate) : localDay(s.eventDate)) : undefined,
    created: localDay(s.creationDate),
    author: s.user ? { id: s.user._id, name: s.user.fullName } : undefined,
    department: s.department || undefined,
    contentType: s.contentType?.displayName,
    labels: s.labels.map((l) => l.name),
    runningSummary: s.parent ? { id: s.parent._id, title: s.parent.title } : undefined,
    range: s.kind === 'running' ? { from: s.rangeStart, to: s.rangeEnd } : undefined,
    sumaroonCount: s.kind === 'running' ? s.sumaroonCount : undefined,
    snippet: snippet(s.content),
  };
}

/** One summary in full, rich text as plain text. */
export function summaryFull(s: ApiSummary): SummaryFull {
  return {
    id: s._id,
    title: s.title,
    kind: s.kind,
    isDraft: s.isDraft,
    eventDate: s.eventDate ? localDay(s.eventDate) : undefined,
    eventTime: s.eventDate && s.eventSecTime ? localTime(s.eventDate) : undefined,
    created: localDateTime(s.creationDate),
    modified: localDateTime(s.modifyDate),
    author: { id: s.user._id, name: s.user.fullName, username: s.user.username },
    department: s.department || undefined,
    contentType: { id: s.contentType._id, name: s.contentType.name, displayName: s.contentType.displayName },
    content: htmlToText(s.content),
    notes: htmlToText(s.notes) || undefined,
    labels: s.labels.map((l) => l.name),
    fields: s.summaryFields.map((f) => ({ fieldId: f.field._id, name: f.field.name, value: f.value })),
    permissions: s.permissions.map((p) => ({ id: p._id, name: p.name })),
    taggedUsers: s.taggedUsers.map((u) => ({ id: u._id, name: u.fullName })),
    taggedPermissions: s.taggedPermissions.map((p) => ({ id: p._id, name: p.name })),
    folders: s.folders.map((f) => ({ id: f._id, name: f.name })),
    files: s.files,
    link: s.link || undefined,
    runningSummary: s.parent ? { id: s.parent._id, title: s.parent.title, range: { from: s.parent.rangeStart, to: s.parent.rangeEnd } } : undefined,
    range: s.kind === 'running' ? { from: s.rangeStart, to: s.rangeEnd } : undefined,
    sumaroonCount: s.kind === 'running' ? s.sumaroonCount : undefined,
    canEdit: s.canEdit,
    comments: s.comments.map((c) => ({ id: c._id, author: c.user?.fullName, date: localDateTime(c.creationDate), content: htmlToText(c.content) })),
  };
}
