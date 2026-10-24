import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzSkeletonModule } from 'ng-zorro-antd/skeleton';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { UserService } from '../../core/auth/user.service';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { ContentTypeIconComponent } from '../../shared/components/content-type-icon.component';
import { ISummary, SearchType, SummaryKind } from '../../shared/models';
import { DateFormatPipe, RichHtmlPipe } from '../../shared/pipes/pipes';
import { SummaryService } from '../../shared/services/summary.service';
import { SummaryActionsService } from '../summaries/summary-actions.service';
import { SummaryBrowserComponent } from '../summaries/summary-browser/summary-browser.component';
import { RunningBackService } from './running-back';

/** /running/:id — a running summary (תמצית רצף): its details on top, its sumaroons below, a sumaroon in the side panel. */
@Component({
  selector: 'app-running-page',
  imports: [
    RouterLink,
    NzButtonModule,
    NzIconModule,
    NzSkeletonModule,
    NzTagModule,
    NzToolTipModule,
    AvatarComponent,
    ContentTypeIconComponent,
    DateFormatPipe,
    RichHtmlPipe,
    SummaryBrowserComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (running(); as r) {
      <app-summary-browser
        [ownerId]="userId()!"
        [runningId]="r._id"
        [fullScreenBase]="['/running', r._id, 's']"
        [searchPlaceholder]="'חיפוש בתוך ' + r.title"
      >
        <header browser-header class="running">
          <div class="top">
            <button nz-button nzType="link" type="button" class="back" (click)="back(r)"><span nz-icon nzType="arrow-right"></span> חזרה</button>
            <span class="spacer"></span>
            <button nz-button nzType="text" nzShape="circle" type="button" (click)="actions.openTimeline(r)" nz-tooltip="ציר זמן" aria-label="ציר זמן">
              <span nz-icon nzType="field-time"></span>
            </button>
            <button nz-button nzType="text" nzShape="circle" type="button" (click)="actions.toggleFavorite(r)" [nz-tooltip]="r.isFavorite ? 'הסרה ממועדפים' : 'הוספה למועדפים'">
              <span nz-icon nzType="star" [nzTheme]="r.isFavorite ? 'fill' : 'outline'"></span>
            </button>
            @if (isMine()) {
              <a nz-button nzType="text" nzShape="circle" [routerLink]="['/summaries', r._id, 'edit']" nz-tooltip="עריכה" aria-label="עריכה"><span nz-icon nzType="edit"></span></a>
              <button nz-button nzType="text" nzShape="circle" nzDanger type="button" (click)="remove(r)" nz-tooltip="מחיקה" aria-label="מחיקה"><span nz-icon nzType="delete"></span></button>
            }
          </div>

          <div class="kind"><span nz-icon nzType="unordered-list"></span> תמצית רצף · {{ r.sumaroonCount ?? 0 }} תמציתוניות</div>
          <h1 class="page-title">{{ r.title }}</h1>

          <div class="meta">
            <span class="who"><app-avatar [user]="r.user" [size]="22" /> <a [routerLink]="['/profile', r.user._id]">{{ r.user.fullName }}</a></span>
            <span><span nz-icon nzType="calendar"></span> {{ r.rangeStart | dateFormat: 'dd/MM/yyyy' }} – {{ r.rangeEnd | dateFormat: 'dd/MM/yyyy' }}</span>
            <span><app-content-type-icon [type]="r.contentType" /> {{ r.contentType.displayName }}</span>
            @for (f of r.summaryFields ?? []; track f.field._id) {
              <span class="field">{{ f.field.name }}: {{ f.value }}</span>
            }
          </div>

          @if (hasContent()) {
            <div class="content" [class.open]="contentOpen()">
              <div class="ql-container ql-snow read-only"><div class="ql-editor" [innerHTML]="r.content | richHtml: null : T.Content"></div></div>
            </div>
            <button nz-button nzType="link" nzSize="small" type="button" class="more" (click)="contentOpen.set(!contentOpen())">
              {{ contentOpen() ? 'פחות' : 'הצגת התוכן המלא' }}
            </button>
          }

          <div class="chips">
            @for (l of r.labels; track l.name) {
              <nz-tag class="label-chip">#{{ l.name }}</nz-tag>
            }
            @for (p of r.permissions; track p._id) {
              <span class="perm"><i [style.background]="p.color"></i>{{ p.name }}</span>
            }
            <span class="spacer"></span>
            <a nz-button nzType="primary" routerLink="/summaries/new" [queryParams]="{ parentId: r._id }"><span nz-icon nzType="plus"></span> תמציתונית</a>
          </div>
        </header>
      </app-summary-browser>
    } @else {
      <div class="loading"><nz-skeleton [nzActive]="true" /></div>
    }
  `,
  styles: `
    :host { display: block; height: 100%; }
    .running {
      display: flex; flex-direction: column; gap: 6px;
      background: #fff; border-radius: 12px; padding: 10px 16px 12px;
      border-inline-start: 6px solid #9b9bb1; box-shadow: 0 2px 20px rgba(0, 0, 0, 0.08);
    }
    .top { display: flex; align-items: center; gap: 2px; }
    .back { padding: 0; }
    .spacer { flex: 1; }
    .kind { font-size: 12px; font-weight: 700; color: #666666; display: flex; gap: 6px; align-items: center; }
    .page-title { margin: 0; }
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; font-size: 13px; color: #666; }
    .who { display: inline-flex; align-items: center; gap: 6px; }
    .content { max-height: 4.5em; overflow: hidden; position: relative; }
    .content.open { max-height: none; }
    .content:not(.open)::after { content: ''; position: absolute; inset: auto 0 0; height: 1.5em; background: linear-gradient(transparent, #fff); }
    .more { align-self: flex-start; padding: 0; }
    .chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .perm { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; background: #efefef; padding: 1px 10px; border-radius: 12px; }
    .perm i { width: 8px; height: 8px; border-radius: 50%; }
    .loading { padding: 24px; }
  `,
})
export class RunningPageComponent {
  private readonly service = inject(SummaryService);
  private readonly users = inject(UserService);
  private readonly router = inject(Router);
  private readonly backs = inject(RunningBackService);
  readonly actions = inject(SummaryActionsService);

  readonly id = input.required<string>();
  readonly running = signal<ISummary | null>(null);
  readonly contentOpen = signal(false);
  readonly userId = this.users.userId;
  readonly isMine = computed(() => this.running()?.user._id === this.users.userId());
  readonly hasContent = computed(() => !!this.running()?.content.replace(/<[^>]+>/g, '').trim());
  readonly T = SearchType;

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => {
        this.backs.remember(id);
        this.load(id);
      });
    });
    const destroyRef = inject(DestroyRef);
    // Sumaroons added/edited/removed change the count; the running summary itself may be favourited or edited.
    this.service.changed$.pipe(takeUntilDestroyed(destroyRef)).subscribe((s) => {
      if (s._id === this.id()) this.running.set({ ...this.running()!, ...s });
      else if (s.parentId === this.id()) this.load(this.id());
    });
    this.service.removed$.pipe(takeUntilDestroyed(destroyRef)).subscribe((id) => {
      if (id === this.id()) this.backs.back(id);
      else this.load(this.id());
    });
  }

  private load(id: string) {
    this.service.get(id).subscribe({
      next: (s) => {
        // Not a running summary → its regular page.
        if (s.kind !== SummaryKind.Running) this.router.navigate(['/summaries', s._id], { replaceUrl: true });
        else this.running.set(s);
      },
      error: () => this.router.navigate(['/not-found'], { skipLocationChange: true }),
    });
  }

  back(r: ISummary) {
    this.backs.back(r._id);
  }

  remove(r: ISummary) {
    this.actions.confirmDelete(r);
  }
}
