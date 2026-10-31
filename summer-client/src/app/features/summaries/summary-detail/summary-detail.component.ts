import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCollapseModule } from 'ng-zorro-antd/collapse';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzSkeletonModule } from 'ng-zorro-antd/skeleton';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { Subscription } from 'rxjs';
import { UserService } from '../../../core/auth/user.service';
import { StorageService } from '../../../core/storage/storage.service';
import { CapsuleCatchComponent } from '../../../shared/components/capsules/capsule-catch/capsule-catch.component';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { ColorPickerComponent } from '../../../shared/components/color-picker/color-picker.component';
import { ContentTypeIconComponent } from '../../../shared/components/content-type-icon/content-type-icon.component';
import { FieldsType, ISummary, ISummaryField, ISummarySearch, SUMMARY_KIND_LABEL, SearchType, SummaryKind } from '../../../shared/models';
import { DateFormatPipe, HighlightPipe, RichHtmlPipe } from '../../../shared/pipes/pipes';
import { SummaryService } from '../../../shared/services/summary.service';
import { MatchNavComponent } from '../match-nav/match-nav.component';
import { SummaryActionsService } from '../summary-actions.service';
import { SumaroonListComponent } from '../running/sumaroon-list/sumaroon-list.component';
import { CommentsComponent } from './comments/comments.component';

const SNAPSHOT_KEY = 'currSummary';

@Component({
  selector: 'app-summary-detail',
  imports: [
    RouterLink,
    NzButtonModule,
    NzCollapseModule,
    NzEmptyModule,
    NzIconModule,
    NzSkeletonModule,
    NzTagModule,
    NzToolTipModule,
    AvatarComponent,
    CapsuleCatchComponent,
    ColorPickerComponent,
    ContentTypeIconComponent,
    CommentsComponent,
    SumaroonListComponent,
    DateFormatPipe,
    HighlightPipe,
    RichHtmlPipe,
    MatchNavComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './summary-detail.component.html',
  styleUrl: './summary-detail.component.scss',
})
export class SummaryDetailComponent {
  private readonly service = inject(SummaryService);
  private readonly storage = inject(StorageService);
  private readonly users = inject(UserService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly actions = inject(SummaryActionsService);
  readonly K = SummaryKind;
  readonly kindLabel = SUMMARY_KIND_LABEL;

  readonly summaryId = input.required<string>();
  readonly mode = input<'panel' | 'page'>('panel');
  readonly search = input<ISummarySearch | null>(null);
  /** Panel: route of a full-screen view of this summary (shows a "full screen" button). */
  readonly fullScreen = input<string[] | null>(null);
  /** Page: where to go once this summary is deleted (default: the feed). */
  readonly exitTo = input<string[] | null>(null);
  readonly closed = output<void>();
  readonly loaded = output<ISummary>();

  readonly summary = signal<ISummary | null>(null);
  readonly loading = signal(false);
  readonly notFound = signal(false);

  readonly T = SearchType;
  readonly isMine = computed(() => this.summary()?.user._id === this.users.userId());

  private inflight?: Subscription;

  constructor() {
    effect(() => {
      const id = this.summaryId();
      untracked(() => this.load(id));
    });

    const destroyRef = inject(DestroyRef);
    this.service.changed$.pipe(takeUntilDestroyed(destroyRef)).subscribe((s) => {
      if (s._id === this.summary()?._id) this.set({ ...this.summary()!, ...s });
    });
    this.service.removed$.pipe(takeUntilDestroyed(destroyRef)).subscribe((id) => {
      if (id !== this.summary()?._id) return;
      this.storage.remove(SNAPSHOT_KEY, 'session');
      if (this.mode() === 'page') this.router.navigate(this.exitTo() ?? ['/summaries']);
      else this.closed.emit();
    });
  }

  private load(id: string) {
    // Render the last-open snapshot instantly on reload, then refresh from the server (also records "seen by").
    const snapshot = this.storage.get<ISummary>(SNAPSHOT_KEY, 'session');
    this.summary.set(snapshot?._id === id ? snapshot : null);
    this.notFound.set(false);
    this.loading.set(true);
    this.inflight?.unsubscribe();
    this.inflight = this.service.get(id).subscribe({
      next: (s) => {
        this.set(s);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        if (!this.summary()) this.notFound.set(true);
      },
    });
  }

  private set(s: ISummary) {
    this.summary.set(s);
    this.loaded.emit(s);
    this.storage.set(SNAPSHOT_KEY, s, 'session');
  }

  onCommentsChange(s: ISummary) {
    this.set(s);
    this.service.patched(s);
  }

  openInNewTab() {
    const url = this.router.serializeUrl(this.router.createUrlTree(['/summaries', this.summaryId()]));
    window.open(url, '_blank', 'noopener');
  }

  download(file: string) {
    this.service.downloadAttachment(this.summaryId(), file).subscribe();
  }

  /** A sumaroon's running summary has its own page. */
  openParent(id: string) {
    this.router.navigate(['/running', id]);
  }

  /** Full screen keeps the list's query params so "back" restores them. */
  openFullScreen(link: string[]) {
    this.router.navigate(link, { queryParams: { ...this.route.snapshot.queryParams, summaryId: null } });
  }

  searchLabel(name: string) {
    this.router.navigate(['/summaries'], { queryParams: { q: name, in: SearchType.Label } });
  }

  fieldValue(f: ISummaryField): { text: string; href?: string } {
    const v = f.value ?? '';
    if (f.field.type === FieldsType.Date && v) {
      const d = new Date(v);
      if (!isNaN(d.getTime())) return { text: d.toLocaleDateString('he-IL') };
    }
    if (/^https?:\/\//i.test(v)) return { text: v, href: v };
    return { text: v };
  }
}
