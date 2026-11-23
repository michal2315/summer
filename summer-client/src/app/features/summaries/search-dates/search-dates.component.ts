import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzPopoverModule } from 'ng-zorro-antd/popover';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { ISummarySearch } from '../../../shared/models';
import { DateRangePanelComponent, describeSpan } from './date-range-panel/date-range-panel.component';

/** Which date a range filters on: the event's (`dates`) or when the summary was written (`createdDates`). */
export type DateField = 'dates' | 'createdDates';
export type DatesPatch = Partial<Pick<ISummarySearch, DateField>>;

const FIELDS: { key: DateField; label: string; short: string }[] = [
  { key: 'dates', label: 'תאריך האירוע', short: 'אירוע' },
  { key: 'createdDates', label: 'תאריך הכתיבה', short: 'נכתבה' },
];

/**
 * The top bar's time-range pill: "כל הזמנים", or the applied range(s) with a ✕ back to all times. A click drops the
 * range panel (calendar or words) down under it, over the page.
 */
@Component({
  selector: 'app-search-dates',
  imports: [NzIconModule, NzPopoverModule, NzToolTipModule, DateRangePanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './search-dates.component.html',
  styleUrl: './search-dates.component.scss',
})
export class SearchDatesComponent {
  readonly search = input<ISummarySearch>({});
  readonly changed = output<DatesPatch>();

  readonly open = signal(false);

  /** The applied ranges, as the pill shows them. */
  readonly active = computed(() =>
    FIELDS.flatMap((f) => {
      const r = this.search()[f.key];
      return r?.length === 2 ? [{ ...f, text: describeSpan({ from: new Date(r[0]), to: new Date(r[1]) }) }] : [];
    }),
  );
  readonly label = computed(() => {
    const a = this.active();
    return a.length ? a.map((x) => (a.length > 1 ? `${x.short} ${x.text}` : x.text)).join(' · ') : 'כל הזמנים';
  });
  readonly tooltip = computed(() => (this.active().length ? this.active().map((a) => `${a.label}: ${a.text}`).join('\n') : 'סינון לפי טווח תאריכים'));

  onClosed(patch: DatesPatch | null) {
    this.open.set(false);
    if (patch) this.changed.emit(patch);
  }

  /** Back to all times on both dates. */
  clearAll() {
    this.open.set(false);
    this.changed.emit({ dates: undefined, createdDates: undefined });
  }
}
