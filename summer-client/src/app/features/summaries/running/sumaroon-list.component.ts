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
import { UserService } from '../../../core/auth/user.service';
import { ISummary, SortKey, SummaryKind } from '../../../shared/models';
import { DateFormatPipe } from '../../../shared/pipes/pipes';
import { SummaryService } from '../../../shared/services/summary.service';

const LIMIT = 100;

/** The sumaroons (תמציתוניות) of a running summary, shown inside its detail view. */
@Component({
  selector: 'app-sumaroon-list',
  imports: [FormsModule, RouterLink, NzButtonModule, NzIconModule, NzRadioModule, NzSpinModule, NzToolTipModule, DateFormatPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let r = running();
    <section class="sumaroons" aria-label="תמציתוניות">
      <header>
        <h3>תמציתוניות ({{ total() }})</h3>
        <span class="range">{{ r.rangeStart | dateFormat: 'dd/MM/yyyy' }} – {{ r.rangeEnd | dateFormat: 'dd/MM/yyyy' }}</span>
        <a class="page-link" [routerLink]="['/running', r._id]">לעמוד תמצית הרצף</a>
        <span class="spacer"></span>
        <nz-radio-group [ngModel]="sort()" (ngModelChange)="sort.set($event)" nzSize="small" nzButtonStyle="solid" aria-label="מיון">
          <label nz-radio-button nzValue="eventDate">לפי תאריך</label>
          <label nz-radio-button nzValue="creationDate">לפי מועד כתיבה</label>
        </nz-radio-group>
        <a nz-button nzType="primary" nzSize="small" routerLink="/summaries/new" [queryParams]="{ parentId: r._id }">
          <span nz-icon nzType="plus"></span> תמציתונית
        </a>
      </header>

      @if (loading() && !items().length) {
        <div class="loader"><nz-spin nzSimple nzSize="small" /></div>
      } @else {
        <ol class="list">
          @for (s of items(); track s._id; let i = $index) {
            <li>
              <button type="button" class="row" (click)="open(s)">
                <span class="index">{{ i + 1 }}</span>
                <span class="main">
                  <span class="title">{{ s.title }}</span>
                  <span class="meta">
                    {{ s.eventDate | dateFormat: 'dd/MM/yyyy' }} · {{ s.user.fullName }}
                  </span>
                </span>
                @for (l of ownLabels(s); track l) {
                  <span class="chip">#{{ l }}</span>
                }
                @if (s.permissions.length) {
                  <span class="lock" nz-icon nzType="lock" [nz-tooltip]="'הרשאות נוספות: ' + permissionNames(s)"></span>
                }
              </button>
              @if (s.link) {
                <a class="link" [href]="s.link" target="_blank" rel="noopener noreferrer" nz-tooltip="קישור" aria-label="קישור"><span nz-icon nzType="link"></span></a>
              }
            </li>
          } @empty {
            <li class="empty muted">עדיין אין תמציתוניות בתמצית הרצף הזו</li>
          }
        </ol>
      }
    </section>
  `,
  styles: `
    .sumaroons { display: flex; flex-direction: column; gap: 8px; margin: 12px 0; }
    header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    h3 { margin: 0; font-size: 16px; font-weight: 800; }
    .range { font-size: 12px; color: #9b9bb1; }
    .spacer { flex: 1; }
    .page-link { font-size: 12px; }
    .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    li { display: flex; align-items: center; gap: 4px; background: #f7f7f7; border-radius: 8px; padding-inline-end: 8px; }
    .row { all: unset; cursor: pointer; flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 8px 10px; }
    .row:focus-visible { outline: 2px solid #01004f; border-radius: 8px; }
    li:hover { background: #efefef; }
    .index { flex: none; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: #fff; font-size: 12px; font-weight: 700; }
    .main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .title { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .meta { font-size: 12px; color: #666; }
    .chip { font-size: 11px; background: #fff; border-radius: 10px; padding: 0 8px; }
    .lock { color: #9b9bb1; }
    .link { color: #01004f; }
    .empty { padding: 10px; background: none; }
    .loader { display: grid; place-items: center; padding: 12px; }
  `,
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
