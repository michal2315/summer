import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { InViewDirective } from '../../../shared/components/in-view.directive';
import { ISummary, ISummarySearch } from '../../../shared/models';
import { DateFormatPipe } from '../../../shared/pipes/pipes';
import { SummaryCardComponent } from '../../summaries/summary-card/summary-card.component';
import { SummaryListStore } from '../../summaries/summary-list.store';

interface Step {
  summary: ISummary;
  /** Position in the series (1 = earliest), whichever direction the list is sorted. */
  number: number;
  date: string | undefined;
}

interface Month {
  key: string;
  label: string;
  steps: Step[];
}

/** A running summary's sumaroons as a vertical timeline: numbered steps along a line, grouped by month. */
@Component({
  selector: 'app-sumaroon-timeline',
  imports: [NzEmptyModule, NzSpinModule, InViewDirective, SummaryCardComponent, DateFormatPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sumaroon-timeline.component.html',
  styleUrl: './sumaroon-timeline.component.scss',
})
export class SumaroonTimelineComponent {
  readonly store = inject(SummaryListStore);

  readonly search = input<ISummarySearch | null>(null);
  readonly openId = input<string | null>(null);
  readonly toggle = output<ISummary>();

  /** The date the list is ordered by: creation date when sorted by it, else the event date. */
  private readonly byCreation = computed(() => (this.search()?.sort ?? 'eventDate').includes('creationDate'));
  private readonly descending = computed(() => (this.search()?.sort ?? 'eventDate').startsWith('-'));

  readonly months = computed<Month[]>(() => {
    const list = this.store.summaries();
    const total = this.store.total();
    const months: Month[] = [];
    list.forEach((summary, index) => {
      const date = this.byCreation() ? summary.creationDate : summary.eventDate;
      const key = date ? format(new Date(date), 'yyyy-MM') : 'none';
      const step: Step = { summary, number: this.descending() ? total - index : index + 1, date };
      const last = months.at(-1);
      if (last?.key === key) last.steps.push(step);
      else months.push({ key, label: date ? format(new Date(date), 'MMMM yyyy', { locale: he }) : 'ללא תאריך', steps: [step] });
    });
    return months;
  });
}
