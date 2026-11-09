import { AltKeyDirective } from '../../../shared/keyboard/alt-key.directive';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { merge } from 'rxjs';
import { UserService } from '../../../core/auth/user.service';
import { ISummarySearch } from '../../../shared/models';
import { FolderService } from '../../../shared/services/folder.service';
import { SummaryService } from '../../../shared/services/summary.service';
import { RunningPageComponent } from '../../running/running-page/running-page.component';
import { SummaryBrowserComponent } from '../../summaries/summary-browser/summary-browser.component';
import { EmptyState } from '../../summaries/summary-list/summary-list.component';
import { SummaryDetailComponent } from '../../summaries/summary-detail/summary-detail.component';
import { FolderCardsComponent } from '../folder-cards/folder-cards.component';
import { FolderTreeStore, NO_FOLDER } from '../folder-tree.store';

/**
 * Home page (/summaries): the summaries list for the selection made in the side nav's folder tree — every summary
 * (root), a folder with its subfolders, or NO_FOLDER. Query params: folderId = the selection (none = root);
 * summaryId = the summary open in the list's side panel (or, under a running summary, in the viewer); runningId = a
 * running summary shown in the viewer instead of the list.
 */
@Component({
  selector: 'app-hierarchy-page',
  imports: [AltKeyDirective, RouterLink, NzButtonModule, NzIconModule, RunningPageComponent, SummaryBrowserComponent, SummaryDetailComponent, FolderCardsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hierarchy-page.component.html',
  styleUrl: './hierarchy-page.component.scss',
})
export class HierarchyPageComponent {
  private readonly users = inject(UserService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly tree = inject(FolderTreeStore);
  readonly userId = computed(() => this.users.userId() ?? '');

  private readonly params = toSignal(this.route.queryParams, { initialValue: {} as Params });
  readonly folderId = computed<string | null>(() => this.params()['folderId'] ?? null);
  readonly summaryId = computed<string | null>(() => this.params()['summaryId'] ?? null);
  readonly runningId = computed<string | null>(() => this.params()['runningId'] ?? null);

  /** The selected folder, when the selection is a real folder. */
  readonly folder = computed(() => this.tree.byId().get(this.folderId() ?? '') ?? null);
  readonly viewTitle = computed(() => (this.folderId() === NO_FOLDER ? 'תמציות ללא שיוך' : (this.folder()?.name ?? 'כל התמציות')));
  /** Breadcrumbs under the title: the selected folder's ancestors, top-level first. */
  readonly ancestors = computed(() => this.tree.ancestors(this.folder()?._id ?? null));
  /** Folders directly under the selection (top-level folders at the root; none for "no folder"). */
  readonly subfolders = computed(() => {
    if (this.folderId() === NO_FOLDER) return [];
    const id = this.folder()?._id ?? null;
    if (this.folderId() && !id) return [];
    return this.tree.children().get(id) ?? [];
  });
  readonly folderTotals = this.tree.totals;
  /** Bumped after tree changes so the listed summaries reload. */
  private readonly refreshTick = signal(0);
  /** What the viewer lists for the selection. A new object on every refresh tick makes the list reload. */
  readonly scope = computed<ISummarySearch>(() => {
    const id = this.folderId();
    this.refreshTick();
    if (id === NO_FOLDER) return { noFolder: true };
    if (id) return { folders: [id] };
    return {};
  });
  readonly empty = computed<EmptyState>(() => {
    if (this.folderId() === NO_FOLDER) return { title: 'כל התמציות משויכות לתיקיות' };
    if (this.folderId()) return { title: 'אין תמציות בתיקייה הזו' };
    return {
      title: 'עדיין אין כאן תמציות',
      hint: 'תמציות שפורסמו ויש לך הרשאה לראות יופיעו כאן.',
      action: { label: 'כתיבת תמצית חדשה', link: ['/summaries/new'] },
    };
  });
  /** Way back from a summary opened inside the running summary in the viewer. */
  readonly backLabel = computed(() => {
    const name = this.tree.itemName(this.runningId());
    return name ? `חזרה לתמצית הרצף "${name}"` : 'חזרה לתמצית הרצף';
  });

  constructor() {
    merge(inject(FolderService).changed$, inject(SummaryService).removed$)
      .pipe(takeUntilDestroyed())
      .subscribe((removedId) => {
        // The open running summary / summary was deleted: show its folder instead.
        if (removedId && (removedId === this.runningId() || removedId === this.summaryId()))
          this.router.navigate([], { relativeTo: this.route, queryParams: { folderId: this.folderId() } });
        this.refreshTick.update((t) => t + 1);
      });
  }

  /** Back from a summary opened inside a running summary (still in the URL) to that running summary. */
  backToContainer() {
    this.router.navigate([], { relativeTo: this.route, queryParams: { summaryId: null }, queryParamsHandling: 'merge' });
  }

  /** Back from an open running summary to the selection's list. */
  backToList() {
    this.router.navigate([], { relativeTo: this.route, queryParams: { runningId: null, summaryId: null }, queryParamsHandling: 'merge' });
  }
}
