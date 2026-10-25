import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { merge } from 'rxjs';
import { UserService } from '../../../../core/auth/user.service';
import { ISummary, SortKey, SummaryKind } from '../../../../shared/models';
import { DateFormatPipe } from '../../../../shared/pipes/pipes';
import { SummaryService } from '../../../../shared/services/summary.service';

const LIMIT = 100;

/** The sumaroons (תמציתוניות) of a running summary, shown inside its detail view. */
@Component({
  selector: 'app-sumaroon-list',
  imports: [FormsModule, RouterLink, NzButtonModule, NzIconModule, NzRadioModule, NzSpinModule, NzToolTipModule, DateFormatPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sumaroon-list.component.html',
  styleUrl: './sumaroon-list.component.scss',
})
export class SumaroonListComponent {
  private readonly service = inject(SummaryService);
  private readonly users = inject(UserService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly running = input.required<ISummary>();

  readonly sort = signal<Extract<SortKey, 'eventDate' | 'creationDate'>>('eventDate');
  readonly items = signal<ISummary[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  private readonly parentLabels = computed(() => new Set(this.running().labels.map((l) => l.name)));

  constructor() {
    effect(() => {
      const id = this.running()._id;
      const sort = this.sort();
      untracked(() => this.load(id, sort));
    });
    // A sumaroon edited or deleted elsewhere (its own panel, a card) → refresh the list.
    merge(this.service.changed$, this.service.removed$)
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(() => this.load(this.running()._id, this.sort()));
  }

  private load(parentId: string, sort: SortKey) {
    this.loading.set(true);
    this.service.search(this.users.userId()!, { parentId, kinds: [SummaryKind.Sumaroon], sort, limit: LIMIT, skip: 0 }).subscribe({
      next: (res) => {
        this.items.set(res.summaries);
        this.total.set(res.lengths.summary);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  /** Labels the sumaroon adds on top of its running summary's. */
  ownLabels(s: ISummary): string[] {
    return s.labels.map((l) => l.name).filter((n) => !this.parentLabels().has(n));
  }

  permissionNames(s: ISummary): string {
    return s.permissions.map((p) => p.name).join(', ');
  }

  /** Inside a panel/viewer (summaryId in the URL) swap what it shows; on the standalone page, navigate. */
  open(s: ISummary) {
    if (this.route.snapshot.queryParamMap.has('summaryId'))
      this.router.navigate([], { relativeTo: this.route, queryParams: { summaryId: s._id }, queryParamsHandling: 'merge' });
    else this.router.navigate(['/summaries', s._id]);
  }
}
