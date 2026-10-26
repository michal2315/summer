import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzSkeletonModule } from 'ng-zorro-antd/skeleton';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { UserService } from '../../../core/auth/user.service';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { ContentTypeIconComponent } from '../../../shared/components/content-type-icon/content-type-icon.component';
import { ISummary, SearchType, SummaryKind } from '../../../shared/models';
import { DateFormatPipe, RichHtmlPipe } from '../../../shared/pipes/pipes';
import { SummaryService } from '../../../shared/services/summary.service';
import { SummaryActionsService } from '../../summaries/summary-actions.service';
import { SummaryBrowserComponent } from '../../summaries/summary-browser/summary-browser.component';
import { RunningBackService } from '../running-back';

/** /running/:id — a running summary (תמצית רצף): its details on top, its sumaroons below, a sumaroon in the side panel. */
import { EmptyState } from '../../summaries/summary-list/summary-list.component';

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
  templateUrl: './running-page.component.html',
  styleUrl: './running-page.component.scss',
})
export class RunningPageComponent {
  readonly empty: EmptyState = { title: 'עדיין אין תמציתוניות בתמצית הרצף הזו' };
  private readonly service = inject(SummaryService);
  private readonly users = inject(UserService);
  private readonly router = inject(Router);
  private readonly backs = inject(RunningBackService);
  readonly actions = inject(SummaryActionsService);

  readonly id = input.required<string>();
  /** Shown inside /hierarchy: no back button; a sumaroon opens in the hierarchy viewer instead of a side panel. */
  readonly embedded = input(false);
  readonly running = signal<ISummary | null>(null);
  readonly detailsOpen = signal(false);
  readonly userId = this.users.userId;
  readonly isMine = computed(() => this.running()?.user._id === this.users.userId());
  readonly hasContent = computed(() => !!this.running()?.content.replace(/<[^>]+>/g, '').trim());
  readonly T = SearchType;

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => {
        if (!this.embedded()) this.backs.remember(id);
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
      // Deleted itself: leave (the hierarchy viewer handles its own tree refresh).
      if (id === this.id()) {
        if (!this.embedded()) this.backs.back(id);
      } else this.load(this.id());
    });
  }

  private load(id: string) {
    this.service.get(id).subscribe({
      next: (s) => {
        // Not a running summary → its regular page.
        if (s.kind !== SummaryKind.Running) this.router.navigate(['/summaries', s._id], { replaceUrl: true });
        else this.running.set(s);
      },
      error: () => {
        if (!this.embedded()) this.router.navigate(['/not-found'], { skipLocationChange: true });
      },
    });
  }

  back(r: ISummary) {
    this.backs.back(r._id);
  }

  remove(r: ISummary) {
    this.actions.confirmDelete(r);
  }
}
