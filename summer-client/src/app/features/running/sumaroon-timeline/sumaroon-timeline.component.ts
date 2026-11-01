import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzPopoverModule } from 'ng-zorro-antd/popover';
import { UserService } from '../../../core/auth/user.service';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { ContentTypeIconComponent } from '../../../shared/components/content-type-icon/content-type-icon.component';
import { InViewDirective } from '../../../shared/components/in-view.directive';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { ISummary, ISummarySearch, SearchType } from '../../../shared/models';
import { DateFormatPipe, HighlightPipe, PlainTextPipe } from '../../../shared/pipes/pipes';
import { SummaryListStore } from '../../summaries/summary-list.store';

interface Step {
  summary: ISummary;
  /** Position in the series (1 = earliest), whichever direction the list is sorted. */
  number: number;
  date: string | undefined;
  /** Time of day, when known (the event's time, or the creation time when sorted by it). */
  time: string | undefined;
}

interface Month {
  key: string;
  label: string;
  steps: Step[];
}

/**
 * A running summary's sumaroons as a vertical timeline, grouped by month: one quiet row per sumaroon (when, a dot on
 * the line, title and preview). Hovering shows its details; clicking opens it.
 */
@Component({
  selector: 'app-sumaroon-timeline',
  imports: [
    NzCheckboxModule,
    NzEmptyModule,
    NzIconModule,
    NzPopoverModule,
    SkeletonComponent,
    AvatarComponent,
    ContentTypeIconComponent,
    InViewDirective,
    DateFormatPipe,
    HighlightPipe,
    PlainTextPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sumaroon-timeline.component.html',
  styleUrl: './sumaroon-timeline.component.scss',
})
export class SumaroonTimelineComponent {
  readonly store = inject(SummaryListStore);
  private readonly users = inject(UserService);

  readonly search = input<ISummarySearch | null>(null);
  readonly openId = input<string | null>(null);
  readonly toggle = output<ISummary>();

  readonly T = SearchType;

  /** The date the list is ordered by: creation date when sorted by it, else the event date. */
  private readonly byCreation = computed(() => (this.search()?.sort ?? 'eventDate').includes('creationDate'));
  private readonly descending = computed(() => (this.search()?.sort ?? 'eventDate').startsWith('-'));

  readonly months = computed<Month[]>(() => {
    const list = this.store.summaries();
    const total = this.store.total();
    const months: Month[] = [];
    list.forEach((summary, index) => {
      const date = this.byCreation() ? summary.creationDate : summary.eventDate;
      const time = this.byCreation() ? summary.creationDate : summary.eventSecTime;
      const key = date ? format(new Date(date), 'yyyy-MM') : 'none';
      const step: Step = { summary, number: this.descending() ? total - index : index + 1, date, time };
      const last = months.at(-1);
      if (last?.key === key) last.steps.push(step);
      else months.push({ key, label: date ? format(new Date(date), 'MMMM yyyy', { locale: he }) : 'ללא תאריך', steps: [step] });
    });
    return months;
  });

  /** Someone else's sumaroon this user hasn't opened yet. */
  unread(s: ISummary): boolean {
    const me = this.users.userId() ?? '';
    return s.user._id !== me && !s.seenBy?.includes(me);
  }

  labelNames(s: ISummary): string[] {
    return s.labels.map((l) => l.name);
  }

  permissionNames(s: ISummary): string {
    return s.permissions.map((p) => p.name).join(', ');
  }
}
