import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { Subscription, merge } from 'rxjs';
import { UserService } from '../../../../core/auth/user.service';
import { InViewDirective } from '../../../../shared/components/in-view.directive';
import { SkeletonComponent } from '../../../../shared/components/skeleton/skeleton.component';
import { ISummary, SummaryKind } from '../../../../shared/models';
import { DateFormatPipe } from '../../../../shared/pipes/pipes';
import { SummaryService } from '../../../../shared/services/summary.service';

const PAGE = 30;

/** The sumaroons (תמציתוניות) of a running summary, shown inside its detail view. */
@Component({
  selector: 'app-sumaroon-list',
  imports: [RouterLink, NzButtonModule, NzIconModule, NzToolTipModule, DateFormatPipe, InViewDirective, SkeletonComponent],
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

  readonly items = signal<ISummary[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly hasMore = computed(() => this.items().length < this.total());
  private inflight?: Subscription;
  private readonly parentLabels = computed(() => new Set(this.running().labels.map((l) => l.name)));

  constructor() {
    effect(() => {
      this.running()._id;
      untracked(() => {
        this.items.set([]);
        this.fetch(0, PAGE);
      });
    });
    // A sumaroon edited or deleted elsewhere (its own panel, a card) → refresh what is listed, keeping how far it reached.
    merge(this.service.changed$, this.service.removed$)
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(() => this.fetch(0, Math.max(PAGE, this.items().length)));
  }

  /** Infinite scroll. */
  loadMore() {
    if (this.loading() || !this.hasMore()) return;
    this.fetch(this.items().length, PAGE);
  }

  /** skip 0 replaces the list; anything else appends to it. */
  private fetch(skip: number, limit: number) {
    const search = { parentId: this.running()._id, kinds: [SummaryKind.Sumaroon], sort: 'eventDate' as const, limit, skip }; // sumaroons always run in timestamp order
    this.inflight?.unsubscribe();
    this.loading.set(true);
    this.inflight = this.service.search(this.users.userId()!, search).subscribe({
      next: (res) => {
        this.items.update((cur) => (skip ? [...cur, ...res.summaries] : res.summaries));
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
