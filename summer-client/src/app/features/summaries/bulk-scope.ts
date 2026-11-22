import { BulkSkipReason, IBulkResult, ISummary, SummaryKind } from '../../shared/models';

/** Which selected summaries a bulk edit applies to, and how many it leaves out (and why). */
export interface BulkScope {
  ids: string[];
  total: number;
  notEditable: number;
  sumaroons: number;
  drafts: number;
}

/**
 * Bulk edits apply only to summaries the user may edit, unless `editOnly: false` (adding to a folder only adds a pointer,
 * so anyone who sees a summary may); `sumaroons: false` also leaves out sumaroons (they live only inside their running
 * summary), `drafts: false` leaves out drafts (they can't sit in a folder).
 * A row never listed (summary unknown) is included — the server re-checks every id.
 */
export function bulkScope(rows: { id: string; summary?: ISummary }[], opts: { editOnly?: boolean; sumaroons?: boolean; drafts?: boolean } = {}): BulkScope {
  const { editOnly = true, sumaroons = true, drafts = true } = opts;
  const scope: BulkScope = { ids: [], total: rows.length, notEditable: 0, sumaroons: 0, drafts: 0 };
  for (const { id, summary } of rows) {
    if (editOnly && summary?.canEdit === false) scope.notEditable++;
    else if (!sumaroons && summary?.kind === SummaryKind.Sumaroon) scope.sumaroons++;
    else if (!drafts && summary?.isDraft) scope.drafts++;
    else scope.ids.push(id);
  }
  return scope;
}

/** "יחול על 7 מתוך 10 · 3 ללא הרשאת עריכה" — empty when the action applies to the whole selection. */
export function scopeNote(s: BulkScope): string {
  if (s.ids.length === s.total) return '';
  const why = [
    s.notEditable ? `${s.notEditable} ללא הרשאת עריכה` : '',
    s.sumaroons ? `${s.sumaroons} תמציתוניות (שייכות לתמצית הרצף שלהן)` : '',
    s.drafts ? `${s.drafts} טיוטות` : '',
  ];
  return [`יחול על ${s.ids.length} מתוך ${s.total}`, ...why.filter(Boolean)].join(' · ');
}

const REASON: Record<BulkSkipReason, string> = {
  'not-found': 'לא נמצאו',
  'not-editor': 'ללא הרשאת עריכה',
  sumaroon: 'תמציתוניות',
  'too-many-labels': 'הגיעו למגבלת התגיות',
  draft: 'טיוטות',
};

/** Toast text for a bulk result: "7 תמציות עודכנו · דולגו: 1 ללא הרשאת עריכה". */
export function bulkResultMessage(r: IBulkResult, done: string): string {
  const counts = new Map<BulkSkipReason, number>();
  for (const s of r.skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  const skipped = [...counts].map(([reason, n]) => `${n} ${REASON[reason]}`).join(', ');
  return skipped ? `${r.applied.length} ${done} · דולגו: ${skipped}` : `${r.applied.length} ${done}`;
}
