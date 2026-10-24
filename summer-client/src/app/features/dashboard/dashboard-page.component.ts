import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzSkeletonModule } from 'ng-zorro-antd/skeleton';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { UserService } from '../../core/auth/user.service';
import { NotificationBellComponent } from '../../shared/components/notification-bell.component';
import { ISummary, SearchType } from '../../shared/models';
import { SummaryService } from '../../shared/services/summary.service';
import { SummaryCubeComponent } from './summary-cube.component';

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
  template: `
    <div class="page">
      <header class="header">
        <h1 class="page-title"><span nz-icon nzType="dashboard"></span> דשבורד</h1>
        <span class="spacer"></span>
        <app-notification-bell />
      </header>

      @if (groups(); as groups) {
        @for (g of groups; track g.key) {
          <section class="group">
            <h2>
              <a [routerLink]="['/summaries']" [queryParams]="{ q: g.key, in: labelType }">{{ g.key }}</a>
              <span class="muted">({{ g.summaries.length }})</span>
            </h2>
            <div class="grid-container">
              @for (s of g.summaries; track s._id) {
                <app-summary-cube [summary]="s" />
              }
            </div>
          </section>
        } @empty {
          <nz-empty nzNotFoundImage="simple" nzNotFoundContent="אין סיכומים להצגה" />
        }
      } @else {
        <nz-skeleton [nzActive]="true" [nzParagraph]="{ rows: 8 }" />
      }
    </div>

    <a nz-button nzType="primary" nzShape="circle" nzSize="large" class="fab" routerLink="/summaries/new" nz-tooltip="יצירת סיכום" nzTooltipPlacement="right" aria-label="יצירת סיכום">
      <span nz-icon nzType="plus"></span>
    </a>
  `,
  styles: `
    :host { display: block; padding: 14px 18px 72px; }
    .page { display: flex; flex-direction: column; gap: 14px; }
    .header { display: flex; align-items: center; gap: 10px; }
    .page-title { display: inline-flex; gap: 6px; align-items: center; }
    .spacer { flex: 1; }
    .group h2 { font-size: 15px; font-weight: 800; margin: 0 0 8px; display: flex; gap: 6px; align-items: baseline; }
    .group h2 a { color: #05043d; }
    .grid-container { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
    .fab { position: fixed; bottom: 24px; left: 24px; width: 52px; height: 52px; box-shadow: 0 4px 16px rgba(255, 64, 86, .4); }
  `,
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
