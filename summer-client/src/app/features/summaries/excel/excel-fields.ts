import { IContentType, IField } from '../../../shared/models';

/** A summary field an Excel column can be mapped onto. `key` is what the server expects in headersMap. */
export interface ImportTarget {
  key: string;
  label: string;
  required?: boolean;
}

export const BASE_TARGETS: ImportTarget[] = [
  { key: 'title', label: 'כותרת', required: true },
  { key: 'content', label: 'תוכן' },
  { key: 'labels', label: 'תגיות (מופרדות בפסיק)' },
  { key: 'eventDate', label: 'תאריך האירוע' },
  { key: 'notes', label: 'הערות' },
  { key: 'department', label: 'מחלקה' },
];

/** Base targets + the content type's own fields (keyed by field id). */
export function targetsFor(type: IContentType | undefined, fieldsById: Map<string, IField>): ImportTarget[] {
  const typeFields = (type?.fields ?? []).flatMap((f) => {
    const field = fieldsById.get(f.field);
    return field ? [{ key: field._id, label: field.name, required: f.required }] : [];
  });
  return [...BASE_TARGETS, ...typeFields];
}

export interface SheetData {
  headers: string[];
  rows: Record<string, unknown>[];
}

/** Parse the first sheet of an .xlsx/.xls/.csv file in the browser. SheetJS is loaded on demand. */
export async function readSheet(file: File): Promise<SheetData> {
  const XLSX = await import('xlsx');
  const book = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) return { headers: [], rows: [] };
  const [headerRow = []] = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  const headers = headerRow.map((h) => String(h ?? '').trim()).filter(Boolean);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  return { headers, rows };
}

/** Auto-map: an Excel header that equals a target's label (or key) maps onto it. */
export function guessMapping(headers: string[], targets: ImportTarget[]): Record<string, string | null> {
  const norm = (s: string) => s.replace(/\s+/g, '').replace(/\(.*\)/, '').toLowerCase();
  return Object.fromEntries(
    targets.map((t) => [t.key, headers.find((h) => norm(h) === norm(t.label) || norm(h) === norm(t.key)) ?? null]),
  );
}
