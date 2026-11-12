import { HttpClient } from '@angular/common/http';
import { Injectable, Pipe, PipeTransform, inject, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';
import { FieldsType, IField, IMailPreferences, INotificationSettings, INotificationSettingsCondition, ISummarySearch, NotificationsFunctionsOptions as F } from '../../shared/models';
import { CAPSULE_TOKEN } from '../../shared/utils/capsules';
import { alertSearch, describeSearch, sameAlertSearch } from '../summaries/search-query';

export interface NotificationOption {
  label: string;
  value: F;
}

/** Not a catalog field: rules on it read the summary's title, content and notes (the server knows the same id). */
export const SUMMARY_TEXT_FIELD: IField = { _id: 'summary-text', name: 'תוכן התמצית', type: FieldsType.String };

/** Operators offered per field type (spec §8.1). Hour fields compare as strings. */
export const OPTIONS_BY_TYPE: Record<FieldsType, NotificationOption[]> = {
  [FieldsType.String]: [
    { label: 'מכיל', value: F.StringContains },
    { label: 'לא מכיל', value: F.StringNotContains },
    { label: 'תואם לכמוסה', value: F.CapsuleMatches },
    { label: 'לא תואם לכמוסה', value: F.CapsuleNotMatches },
  ],
  [FieldsType.Hour]: [
    { label: 'מכיל', value: F.StringContains },
    { label: 'לא מכיל', value: F.StringNotContains },
  ],
  [FieldsType.Number]: [
    { label: 'גדול מ', value: F.NumberBigger },
    { label: 'קטן מ', value: F.NumberSmaller },
    { label: 'שווה ל', value: F.NumberEqual },
    { label: 'בין', value: F.NumberBetween },
  ],
  [FieldsType.Date]: [
    { label: 'אחרי', value: F.DateAfter },
    { label: 'לפני', value: F.DateBefore },
    { label: 'בין התאריכים', value: F.DateBetween },
  ],
  [FieldsType.Array]: [
    { label: 'כולל', value: F.ArrayContains },
    { label: 'לא כולל', value: F.ArrayNotContains },
  ],
};

const LABELS = new Map(Object.values(OPTIONS_BY_TYPE).flat().map((o) => [o.value, o.label]));

export const isBetween = (f: F | null | undefined) => f === F.NumberBetween || f === F.DateBetween;
/** content: [capsule id, capsule name] */
export const isCapsuleFunc = (f: F | null | undefined) => f === F.CapsuleMatches || f === F.CapsuleNotMatches;

/** Rule → readable Hebrew, e.g. «שם הקורס מכיל "אלגוריתמים" וגם מספר הרצאה בין 3 ל-∞», or «חיפוש: …» for a search alert. */
export function describeRule(rule: Pick<INotificationSettings, 'conditions' | 'matchAny' | 'search'>): string {
  if (rule.search) return `תמציות שמתאימות לחיפוש: ${describeSearch(rule.search)}`;
  return rule.conditions.map(describeCondition).join(rule.matchAny ? ' או ' : ' וגם ');
}

export function describeCondition(c: INotificationSettingsCondition): string {
  const fmt = (v: string | number | null | undefined) => {
    if (v === null || v === undefined || v === '') return '∞';
    if (c.field.type === FieldsType.Date) return new Date(v).toLocaleDateString('he-IL');
    return typeof v === 'string' ? `"${v}"` : String(v);
  };
  const op = LABELS.get(c.funcName) ?? c.funcName;
  if (isCapsuleFunc(c.funcName)) return `${c.field.name} ${op} #${c.content[1] ?? c.content[0]}`;
  if (isBetween(c.funcName)) return `${c.field.name} ${op} ${fmt(c.content[0])} ל-${fmt(c.content[1])}`;
  return `${c.field.name} ${op} ${c.content.map(fmt).join(', ')}`;
}

/**
 * What to highlight in a summary a rule alerted on, as a search the highlight pipes understand: a saved search as is;
 * for conditions, the words (or capsules) they require in the summary's text. Null when the rule only looks at fields.
 */
export function ruleHighlight(rule: Pick<INotificationSettings, 'conditions' | 'search'>): ISummarySearch | null {
  if (rule.search) return rule.search;
  const words = rule.conditions
    .filter((c) => c.field._id === SUMMARY_TEXT_FIELD._id)
    .flatMap((c) => {
      if (c.funcName === F.StringContains) return c.content.filter((v): v is string => typeof v === 'string' && !!v.trim());
      if (c.funcName === F.CapsuleMatches && typeof c.content[0] === 'string') return [CAPSULE_TOKEN + c.content[0]];
      return [];
    });
  return words.length ? { query: { type: 'group', op: 'OR', children: [{ type: 'cond', field: 'text', op: 'any', words }] } } : null;
}

/** Capsule ids a rule's highlight needs loaded. */
export const ruleCapsuleIds = (rule: Pick<INotificationSettings, 'conditions'>): string[] =>
  rule.conditions.filter((c) => isCapsuleFunc(c.funcName) && typeof c.content[0] === 'string').map((c) => c.content[0] as string);

@Pipe({ name: 'notificationName' })
export class NotificationNamePipe implements PipeTransform {
  transform(rule: Pick<INotificationSettings, 'conditions' | 'matchAny' | 'search'>): string {
    return describeRule(rule);
  }
}

/** Notification-rule admin state (spec §11.2): rules + a text filter, and the user's e-mail switches. */
@Injectable({ providedIn: 'root' })
export class NotificationsSettingsService {
  private readonly http = inject(HttpClient);
  readonly rules = signal<INotificationSettings[] | null>(null);
  readonly filter = signal('');
  readonly preferences = signal<IMailPreferences | null>(null);

  load(): void {
    this.http.get<INotificationSettings[]>('/api/notifications/settings').subscribe((r) => this.rules.set(r));
  }

  loadPreferences(): void {
    this.http.get<IMailPreferences>('/api/notifications/preferences').subscribe((p) => this.preferences.set(p));
  }

  /** Optimistic; the server's answer replaces the local copy, a failure restores it. */
  setPreference(key: 'mailAlerts' | 'mailActivity', value: boolean): void {
    const before = this.preferences();
    if (before) this.preferences.set({ ...before, [key]: value });
    this.http.put<IMailPreferences>('/api/notifications/preferences', { [key]: value }).subscribe({
      next: (p) => this.preferences.set(p),
      error: () => this.preferences.set(before),
    });
  }

  /** The API has no single-rule endpoint; read the list and pick the rule. */
  findById(id: string): Observable<INotificationSettings | undefined> {
    return this.http.get<INotificationSettings[]>('/api/notifications/settings').pipe(
      tap((r) => this.rules.set(r)),
      map((r) => r.find((x) => x._id === id)),
    );
  }

  save(rule: INotificationSettings): Observable<INotificationSettings> {
    const req = rule._id ? this.http.put<INotificationSettings>('/api/notifications', rule) : this.http.post<INotificationSettings>('/api/notifications', rule);
    return req.pipe(tap(() => this.load()));
  }

  delete(id: string): Observable<unknown> {
    return this.http.delete(`/api/notifications/${id}`).pipe(tap(() => this.load()));
  }

  /** The alert rule saved for this search, if any (needs `load()` first). */
  alertFor(search: ISummarySearch): INotificationSettings | undefined {
    return this.rules()?.find((r) => r.search && sameAlertSearch(r.search, search));
  }

  /** "Notify me about new results": a rule holding the search, named after it (or after the saved search's name). */
  addAlert(search: ISummarySearch, name?: string | null): Observable<INotificationSettings> {
    const s = alertSearch(search);
    return this.save({ name: (name || describeSearch(s)).slice(0, 120), conditions: [], search: s, isNotify: true, isMail: false, isDigest: false });
  }
}
