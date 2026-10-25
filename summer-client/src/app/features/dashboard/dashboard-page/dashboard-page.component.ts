import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzSkeletonModule } from 'ng-zorro-antd/skeleton';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { UserService } from '../../../core/auth/user.service';
import { NotificationBellComponent } from '../../../shared/components/notification-bell/notification-bell.component';
import { ISummary, SearchType } from '../../../shared/models';
import { SummaryService } from '../../../shared/services/summary.service';
import { SummaryCubeComponent } from '../summary-cube/summary-cube.component';

interface Group {
  key: string;
  summaries: ISummary[];
}

/** Groups in a stable order: biggest first, then alphabetically. */
export function getSummariesPerLabel(grouped: Record<string, ISummary[]>): Group[] {
  return Object.entries(grouped)
    .filter(([, list]) => list.length)
    .map(([key, summaries]) => ({ key, summaries }))
    .sort((a, b) => b.summaries.length - a.summaries.length || a.key.localeCompare(b.key, 'he'));
}

/** /dashboard — grid of summary cubes per group (spec §10.10). */
@Component({
  selector: 'app-dashboard-page',
  imports: [RouterLink, NzButtonModule, NzEmptyModule, NzIconModule, NzSkeletonModule, NzToolTipModule, NotificationBellComponent, SummaryCubeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard-page.component.html',
  styleUrl: './dashboard-page.component.scss',
})
export class DashboardPageComponent {
  private readonly summaries = inject(SummaryService);
  private readonly users = inject(UserService);

  readonly labelType = SearchType.Label;
  private readonly data = signal<Record<string, ISummary[]> | null>(null);
  readonly groups = computed(() => {
    const d = this.data();
    return d ? getSummariesPerLabel(d) : null;
  });

  constructor() {
    this.summaries.dashboard(this.users.userId()!).subscribe((d) => this.data.set(d));
  }
}
