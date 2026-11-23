import { ChangeDetectionStrategy, Component, ElementRef, computed, input, linkedSignal, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { format, startOfDay, subDays, subMonths, subYears } from 'date-fns';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzDatePickerModule } from 'ng-zorro-antd/date-picker';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { DaySpan, EARLIEST, parseDateRange, spanDays } from '../../../../shared/utils/natural-dates';
import type { DateField, DatesPatch } from '../search-dates.component';

export interface DateRangePanelData {
  dates?: string[];
  createdDates?: string[];
}

const FIELDS: { key: DateField; label: string }[] = [
  { key: 'dates', label: 'תאריך האירוע' },
  { key: 'createdDates', label: 'תאריך הכתיבה' },
];

/** The two ways to pick, as the panel's tabs. */
const MODES = [
  { label: 'טווח תאריכים', icon: 'calendar' },
  { label: 'מילולי', icon: 'edit' },
];

/** Quick ranges, each ending today. */
const PRESETS: { label: string; from: (today: Date) => Date }[] = [
  { label: 'היום', from: (d) => d },
  { label: '7 ימים', from: (d) => subDays(d, 6) },
  { label: 'חודש', from: (d) => subMonths(d, 1) },
  { label: '3 חודשים', from: (d) => subMonths(d, 3) },
  { label: 'שנה', from: (d) => subYears(d, 1) },
];

/** What the words tab offers to try (clicking one types it). */
const EXAMPLES = ['השבוע', 'החודש שעבר', '3 חודשים אחרונים', 'מאז ינואר', 'בין מרץ למאי', '1/3 עד 15/4', 'לפני שבועיים', '2025'];

type Draft = Record<DateField, string[] | null>;

const day = (d: Date) => format(d, 'd/M/yy');
/** ISO instants of local midnight (the server reads them as calendar days). */
const toIso = (r: DaySpan): string[] => [startOfDay(r.from).toISOString(), startOfDay(r.to).toISOString()];
const fromIso = (r: string[] | null): DaySpan | null => (r?.length === 2 ? { from: new Date(r[0]), to: new Date(r[1]) } : null);
export const describeSpan = (r: DaySpan) => (r.from.getTime() <= EARLIEST.getTime() ? `עד ${day(r.to)}` : r.from.getTime() === r.to.getTime() ? day(r.from) : `${day(r.from)} – ${day(r.to)}`);

/**
 * The search's time range, edited in the pill's dropdown: per date (event / written), picked on a calendar or written in words
 * ("3 חודשים אחרונים", "מאז מרץ"). Nothing applies until "החלה"; "כל הזמנים" clears the date being edited.
 */
@Component({
  selector: 'app-date-range-panel',
  imports: [FormsModule, NzButtonModule, NzDatePickerModule, NzIconModule, NzInputModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './date-range-panel.component.html',
  styleUrl: './date-range-panel.component.scss',
})
export class DateRangePanelComponent {
  /** The applied ranges (the draft starts from them). */
  readonly value = input<DateRangePanelData>({});
  /** The new ranges on "החלה", or null to close without change. */
  readonly closed = output<DatesPatch | null>();

  readonly fields = FIELDS;
  readonly modes = MODES;
  readonly presets = PRESETS;
  readonly examples = EXAMPLES;

  readonly draft = linkedSignal<Draft>(() => {
    const v = this.value();
    return { dates: v.dates?.length === 2 ? v.dates : null, createdDates: v.createdDates?.length === 2 ? v.createdDates : null };
  });
  /** Opens on the date that has a range (the event date when neither or both do). */
  readonly field = linkedSignal<DateField>(() => (this.value().createdDates?.length === 2 && this.value().dates?.length !== 2 ? 'createdDates' : 'dates'));
  readonly tab = signal(0);
  private readonly wordsInput = viewChild<ElementRef<HTMLInputElement>>('wordsInput');

  /** The words tab focuses its box, so it can be typed in right away. */
  onTab(i: number) {
    this.tab.set(i);
    if (i === 1) setTimeout(() => this.wordsInput()?.nativeElement.focus());
  }
  readonly words = signal('');

  readonly current = computed(() => fromIso(this.draft()[this.field()]));
  readonly picked = computed<Date[]>(() => {
    const r = this.current();
    return r ? [r.from, r.to] : [];
  });
  readonly currentText = computed(() => {
    const r = this.current();
    return r ? describeSpan(r) : 'כל הזמנים';
  });
  readonly parsed = computed(() => parseDateRange(this.words()));
  readonly parsedText = computed(() => {
    const r = this.parsed();
    if (!r) return '';
    const n = spanDays(r);
    return `${describeSpan(r)} · ${n === 1 ? 'יום אחד' : `${n.toLocaleString('he-IL')} ימים`}`;
  });
  readonly has = (key: DateField) => !!this.draft()[key];
  readonly changed = computed(() => {
    const d = this.draft();
    const same = (a: string[] | null, b: string[] | undefined) => (a ?? []).join() === (b?.length === 2 ? b : []).join();
    return !same(d.dates, this.value().dates) || !same(d.createdDates, this.value().createdDates);
  });

  private set(r: DaySpan | null) {
    this.draft.update((d) => ({ ...d, [this.field()]: r ? toIso(r) : null }));
  }

  preset(p: (typeof PRESETS)[number]) {
    const today = new Date();
    this.set({ from: p.from(today), to: today });
  }

  onPick(range: (Date | null)[] | null) {
    const [from, to] = range ?? [];
    if (from && to) this.set({ from, to });
  }

  /** Typing sets the range as soon as the words read as one. */
  onWords(text: string) {
    this.words.set(text);
    const r = this.parsed();
    if (r) this.set(r);
  }

  example(text: string) {
    this.onWords(text);
  }

  allTimes() {
    this.set(null);
    this.words.set('');
  }

  apply() {
    const d = this.draft();
    this.closed.emit({ dates: d.dates ?? undefined, createdDates: d.createdDates ?? undefined });
  }

  /** Enter in the words box applies what they read as (and does nothing while they don't). */
  applyWords() {
    if (this.parsed()) this.apply();
  }

  cancel() {
    this.closed.emit(null);
  }
}
