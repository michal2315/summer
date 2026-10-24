import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzDropDownModule } from 'ng-zorro-antd/dropdown';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { merge } from 'rxjs';
import { UserService } from '../../core/auth/user.service';
import { FolderItemType, IFolder, IFolderItem } from '../../shared/models';
import { FolderService } from '../../shared/services/folder.service';
import { SummaryService } from '../../shared/services/summary.service';
import { CollectionSummariesPageComponent } from '../collections/collection-summaries-page.component';
import { SummaryDetailComponent } from '../summaries/summary-detail/summary-detail.component';
import { AddToFolderData, AddToFolderModalComponent } from './add-to-folder-modal.component';
import { FolderEditorData, FolderEditorModalComponent } from './folder-editor-modal.component';

const byName = (a: IFolder, b: IFolder) => a.name.localeCompare(b.name, 'he');

/**
 * /hierarchy — folder tree (folders, collections, summaries) beside a viewer.
 * Query params: folderId = selected folder (or the folder holding the open item), summaryId / collectionId = item shown in the viewer.
 */
@Component({
  selector: 'app-hierarchy-page',
  imports: [
    NgTemplateOutlet,
    RouterLink,
    NzButtonModule,
    NzDropDownModule,
    NzEmptyModule,
    NzIconModule,
    NzSpinModule,
    NzToolTipModule,
    CollectionSummariesPageComponent,
    SummaryDetailComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hierarchy-page.component.html',
  styleUrl: './hierarchy-page.component.scss',
})
export class HierarchyPageComponent {
  private readonly service = inject(FolderService);
  private readonly users = inject(UserService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly modal = inject(NzModalService);
  private readonly message = inject(NzMessageService);

  private readonly params = toSignal(this.route.queryParams, { initialValue: {} as Params });
  readonly folderId = computed<string | null>(() => this.params()['folderId'] ?? null);
  readonly summaryId = computed<string | null>(() => this.params()['summaryId'] ?? null);
  readonly collectionId = computed<string | null>(() => this.params()['collectionId'] ?? null);

  readonly folders = signal<IFolder[]>([]);
  readonly treeLoaded = signal(false);
  readonly expanded = signal(new Set<string>());
  /** Items of each expanded folder, loaded on first expand. */
  readonly items = signal(new Map<string, IFolderItem[]>());

  readonly byId = computed(() => new Map(this.folders().map((f) => [f._id, f])));
  /** parentId (null = root) → child folders, sorted by name. */
  readonly children = computed(() => {
    const map = new Map<string | null, IFolder[]>();
    for (const f of this.folders()) map.set(f.parentId, [...(map.get(f.parentId) ?? []), f]);
    for (const list of map.values()) list.sort(byName);
    return map;
  });

  readonly itemOpen = computed(() => !!this.summaryId() || !!this.collectionId());
  /** Name of the open collection, from the loaded tree items (used by the back button). */
  readonly collectionName = computed(() => {
    const id = this.collectionId();
    for (const list of this.items().values()) {
      const c = list.find((i) => i.type === 'collection' && i._id === id);
      if (c) return `"${c.name}"`;
    }
    return '';
  });

  constructor() {
    this.loadTree();
    // Reveal the selected folder (and, when an item is open, its contents) in the tree.
    effect(() => {
      const byId = this.byId();
      const path: string[] = [];
      for (let f = byId.get(this.folderId() ?? ''); f; f = f.parentId ? byId.get(f.parentId) : undefined) path.unshift(f._id);
      if (!this.itemOpen()) path.pop();
      untracked(() => path.forEach((id) => this.expand(id)));
    });
    merge(this.service.changed$, inject(SummaryService).removed$)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.refresh());
  }

  private loadTree() {
    this.service.tree().subscribe({
      next: (list) => {
        this.folders.set(list);
        this.treeLoaded.set(true);
      },
      error: () => this.treeLoaded.set(true),
    });
  }

  private loadItems(folderId: string) {
    this.service.items(folderId).subscribe((list) => this.items.update((m) => new Map(m).set(folderId, list)));
  }

  /** After a mutation: reload the tree and the items of every loaded folder. */
  private refresh() {
    this.loadTree();
    for (const id of this.items().keys()) this.loadItems(id);
  }

  itemIcon(item: IFolderItem): string {
    if (item.type === 'collection') return 'appstore';
    return item.kind === 'running' ? 'unordered-list' : 'file-text';
  }

  canExpand(f: IFolder) {
    return f.itemCount > 0 || !!this.children().get(f._id)?.length;
  }

  isManager(f: IFolder) {
    return f.managers.includes(this.users.userId() ?? '');
  }

  expand(id: string) {
    if (!this.items().has(id)) this.loadItems(id);
    if (!this.expanded().has(id)) this.expanded.update((s) => new Set(s).add(id));
  }

  toggle(id: string) {
    if (this.expanded().has(id)) {
      this.expanded.update((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    } else this.expand(id);
  }

  isOpen(type: FolderItemType, id: string) {
    return (type === 'summary' ? this.summaryId() : this.collectionId()) === id;
  }

  itemParams(folderId: string, item: IFolderItem): Params {
    return { folderId, [item.type === 'summary' ? 'summaryId' : 'collectionId']: item._id };
  }

  /** A summary opened from inside a collection keeps collectionId in the URL; dropping summaryId shows the collection again. */
  backToCollection() {
    this.router.navigate([], { relativeTo: this.route, queryParams: { summaryId: null }, queryParamsHandling: 'merge' });
  }

  private select(folderId: string | null) {
    this.router.navigate([], { relativeTo: this.route, queryParams: { folderId } });
  }

  create(parent: IFolder | null) {
    this.modal
      .create<FolderEditorModalComponent, FolderEditorData, IFolder>({
        nzTitle: parent ? `תיקיית משנה ב"${parent.name}"` : 'תיקייה חדשה',
        nzContent: FolderEditorModalComponent,
        nzData: { parentId: parent?._id ?? null },
        nzFooter: null,
        nzWidth: 480,
      })
      .afterClose.subscribe((created) => created && parent && this.expand(parent._id));
  }

  edit(f: IFolder) {
    this.modal.create<FolderEditorModalComponent, FolderEditorData, IFolder>({
      nzTitle: 'עריכת תיקייה',
      nzContent: FolderEditorModalComponent,
      nzData: { folder: f },
      nzFooter: null,
      nzWidth: 480,
    });
  }

  addItems(f: IFolder) {
    this.modal
      .create<AddToFolderModalComponent, AddToFolderData, boolean>({
        nzTitle: `הוספה אל "${f.name}"`,
        nzContent: AddToFolderModalComponent,
        nzData: { folderId: f._id, folderName: f.name },
        nzFooter: null,
        nzWidth: 480,
      })
      .afterClose.subscribe((added) => added && this.expand(f._id));
  }

  removeItem(f: IFolder, item: IFolderItem) {
    this.service.removeItems(f._id, [item]).subscribe(() => {
      this.message.success(`"${item.name}" הוצא מהתיקייה`);
      if (this.isOpen(item.type, item._id)) this.select(f._id);
    });
  }

  remove(f: IFolder) {
    this.modal.confirm({
      nzTitle: `למחוק את התיקייה "${f.name}"?`,
      nzContent: 'גם תיקיות המשנה שבה יימחקו. האוספים והסיכומים שבתוכה לא יימחקו — הם רק יוצאו מההיררכיה.',
      nzOkText: 'מחיקה',
      nzOkDanger: true,
      nzCancelText: 'ביטול',
      nzOnOk: () =>
        new Promise<void>((resolve, reject) =>
          this.service.delete(f._id).subscribe({
            next: () => {
              this.message.success('התיקייה נמחקה');
              this.select(f.parentId);
              resolve();
            },
            error: reject,
          }),
        ),
    });
  }
}
