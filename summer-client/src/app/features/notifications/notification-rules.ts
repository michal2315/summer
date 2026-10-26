import { HttpClient } from '@angular/common/http';
import { Injectable, Pipe, PipeTransform, inject, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';
import { FieldsType, IField, INotificationSettings, INotificationSettingsCondition, NotificationsFunctionsOptions as F } from '../../shared/models';

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

/** Rule → readable Hebrew, e.g. «שם הקורס מכיל "אלגוריתמים" וגם מספר הרצאה בין 3 ל-∞». */
export function describeRule(rule: Pick<INotificationSettings, 'conditions'>): string {
  return rule.conditions.map(describeCondition).join(' וגם ');
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

@Pipe({ name: 'notificationName' })
export class NotificationNamePipe implements PipeTransform {
  transform(rule: Pick<INotificationSettings, 'conditions'>): string {
    return describeRule(rule);
  }
}

/** Notification-rule admin state (spec §11.2): rules + a text filter. */
@Injectable({ providedIn: 'root' })
export class NotificationsSettingsService {
  private readonly http = inject(HttpClient);
  readonly rules = signal<INotificationSettings[] | null>(null);
  readonly filter = signal('');

  load(): void {
    this.http.get<INotificationSettings[]>('/api/notifications/settings').subscribe((r) => this.rules.set(r));
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
}
