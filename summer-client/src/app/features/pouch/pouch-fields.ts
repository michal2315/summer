import { format } from 'date-fns';
import { FieldsType, IContentType, IField, ISummary } from '../../shared/models';
import { summaryPageLink } from '../../shared/utils/summary-links';

/** A field a format can place: a summary's own field (title, content…) or a custom field (`field:<id>`). */
export interface PouchField {
  key: string;
  label: string;
  /** Its value is rich text (Quill HTML): a per-summary export keeps its formatting. */
  rich?: boolean;
}

/** Fields every summary has. */
export const CORE_FIELDS: PouchField[] = [
  { key: 'title', label: 'כותרת' },
  { key: 'content', label: 'תוכן', rich: true },
  { key: 'notes', label: 'הערות', rich: true },
  { key: 'author', label: 'מחבר' },
  { key: 'department', label: 'מחלקה' },
  { key: 'contentType', label: 'סוג תוכן' },
  { key: 'eventDate', label: 'תאריך האירוע' },
  { key: 'eventTime', label: 'שעת האירוע' },
  { key: 'creationDate', label: 'תאריך יצירה' },
  { key: 'modifyDate', label: 'תאריך עדכון' },
  { key: 'labels', label: 'תגיות' },
  { key: 'folders', label: 'תיקיות' },
  { key: 'taggedUsers', label: 'מתויגים' },
  { key: 'permissions', label: 'הרשאות' },
  { key: 'link', label: 'קישור לתמצית' },
];

const CUSTOM_PREFIX = 'field:';
export const customKey = (fieldId: string) => `${CUSTOM_PREFIX}${fieldId}`;
const customId = (key: string) => (key.startsWith(CUSTOM_PREFIX) ? key.slice(CUSTOM_PREFIX.length) : null);

export interface PouchFieldGroup {
  id: string;
  label: string;
  fields: PouchField[];
}

/** The sidebar's sections: the common fields, one section per intel (content) type, then every custom field. */
export function fieldGroups(types: IContentType[], fields: IField[]): PouchFieldGroup[] {
  const byId = new Map(fields.map((f) => [f._id, f]));
  const custom = (f: IField): PouchField => ({ key: customKey(f._id), label: f.name });
  return [
    { id: 'core', label: 'שדות כלליים', fields: CORE_FIELDS },
    ...types
      .map((t) => ({
        id: `type:${t._id}`,
        label: t.displayName,
        fields: (t.fields ?? []).flatMap((tf) => {
          const f = byId.get(tf.field);
          return f ? [custom(f)] : [];
        }),
      }))
      .filter((g) => g.fields.length),
    { id: 'custom', label: 'שדות מותאמים', fields: [...fields].sort((a, b) => a.name.localeCompare(b.name, 'he')).map(custom) },
  ];
}

/** Label of a field key, for chips: current names win over the label saved in the document. */
export function fieldLabel(key: string, fields: Map<string, IField>): string | undefined {
  const id = customId(key);
  if (id) return fields.get(id)?.name;
  return CORE_FIELDS.find((f) => f.key === key)?.label;
}

export const isRichField = (key: string) => CORE_FIELDS.some((f) => f.key === key && f.rich);

const day = (iso: string | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : format(d, 'dd/MM/yyyy');
};

/** "HH:mm", or a full date-time → its time. */
const time = (v: string | undefined) => {
  if (!v) return '';
  if (/^\d{1,2}:\d{2}/.test(v)) return v.slice(0, 5);
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : format(d, 'HH:mm');
};

const list = (items: { name?: string; fullName?: string }[] | undefined) =>
  (items ?? [])
    .map((i) => i.fullName ?? i.name ?? '')
    .filter(Boolean)
    .join(', ');

/** Plain text of Quill HTML (paragraph and line breaks become spaces). */
export function htmlText(html: string): string {
  const doc = new DOMParser().parseFromString(html.replace(/<(br|\/p|\/h\d|\/li|\/div|\/tr)\b[^>]*>/gi, ' $&'), 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** A summary's value for a field key, as text ('' when it has none). Rich fields give their plain text. */
export function fieldText(s: ISummary, key: string, origin = location.origin): string {
  const id = customId(key);
  if (id) {
    const sf = s.summaryFields?.find((f) => f.field._id === id);
    const v = sf?.value ?? '';
    if (!v) return '';
    if (sf?.field.type === FieldsType.Date) return day(v) || v;
    if (sf?.field.type === FieldsType.Hour) return time(v) || v;
    return v;
  }
  switch (key) {
    case 'title':
      return s.title ?? '';
    case 'content':
      return htmlText(s.content ?? '');
    case 'notes':
      return htmlText(s.notes ?? '');
    case 'author':
      return s.user?.fullName ?? '';
    case 'department':
      return s.department ?? '';
    case 'contentType':
      return s.contentType?.displayName ?? '';
    case 'eventDate':
      return day(s.eventDate);
    case 'eventTime':
      return time(s.eventSecTime);
    case 'creationDate':
      return day(s.creationDate);
    case 'modifyDate':
      return day(s.modifyDate);
    case 'labels':
      return list(s.labels);
    case 'folders':
      return list(s.folders);
    case 'taggedUsers':
      return [list(s.taggedUsers), list(s.taggedPermissions)].filter(Boolean).join(', ');
    case 'permissions':
      return list(s.permissions);
    case 'link':
      return `${origin}${summaryPageLink(s).join('/')}`;
    default:
      return '';
  }
}

/** A rich field's HTML ('' when empty or not rich). */
export function fieldHtml(s: ISummary, key: string): string {
  if (key === 'content') return s.content ?? '';
  if (key === 'notes') return s.notes ?? '';
  return '';
}
