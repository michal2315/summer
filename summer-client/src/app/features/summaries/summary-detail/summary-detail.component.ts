import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { NzAlertModule } from 'ng-zorro-antd/alert';
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
import { AvatarComponent } from '../../../shared/components/avatar.component';
import { ColorPickerComponent } from '../../../shared/components/color-picker.component';
import { ContentTypeIconComponent } from '../../../shared/components/content-type-icon.component';
import { FieldsType, ISummary, ISummaryField, ISummarySearch, SearchType } from '../../../shared/models';
import { DateFormatPipe, HighlightPipe, RichHtmlPipe } from '../../../shared/pipes/pipes';
import { SummaryService } from '../../../shared/services/summary.service';
import { SummaryActionsService } from '../summary-actions.service';
import { CommentsComponent } from './comments.component';

const SNAPSHOT_KEY = 'currSummary';

@Component({
  selector: 'app-summary-detail',
  imports: [
    RouterLink,
    NzAlertModule,
    NzButtonModule,
    NzCollapseModule,
    NzEmptyModule,
    NzIconModule,
    NzSkeletonModule,
    NzTagModule,
    NzToolTipModule,
    AvatarComponent,
    ColorPickerComponent,
    ContentTypeIconComponent,
    CommentsComponent,
    DateFormatPipe,
    HighlightPipe,
    RichHtmlPipe,
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
  readonly actions = inject(SummaryActionsService);

  readonly summaryId = input.required<string>();
  readonly mode = input<'panel' | 'page'>('panel');
  readonly search = input<ISummarySearch | null>(null);
  readonly closed = output<void>();

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
      if (this.mode() === 'page') this.router.navigate(['/summaries']);
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
