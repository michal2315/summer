import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
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
import { UserService } from '../../../core/auth/user.service';
import { StorageService } from '../../../core/storage/storage.service';
import { IFolder, IFolderItem, SummaryKind } from '../../../shared/models';
import { FolderService } from '../../../shared/services/folder.service';
import { SummaryService } from '../../../shared/services/summary.service';
import { CollectionSummariesPageComponent } from '../../collections/collection-summaries-page/collection-summaries-page.component';
import { RunningPageComponent } from '../../running/running-page/running-page.component';
import { SummaryDetailComponent } from '../../summaries/summary-detail/summary-detail.component';
import { AddToFolderData, AddToFolderModalComponent } from '../add-to-folder-modal/add-to-folder-modal.component';
import { FolderEditorData, FolderEditorModalComponent } from '../folder-editor-modal/folder-editor-modal.component';

const byName = (a: IFolder, b: IFolder) => a.name.localeCompare(b.name, 'he');

const WIDTH_KEY = 'hierarchyTreeWidth';
const MIN_WIDTH = 200;
const DEFAULT_WIDTH = 300;

/**
 * /hierarchy — folder tree (folders, collections, summaries) beside a viewer.
 * Query params: folderId = selected folder (or the folder holding the open item); collectionId / runningId = the
 * collection or running summary shown in the viewer; summaryId = a summary shown in the viewer (alone, or opened
 * from inside that collection / running summary, with a way back).
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
    RunningPageComponent,
    SummaryDetailComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hierarchy-page.component.html',
  styleUrl: './hierarchy-page.component.scss',
})
export class HierarchyPageComponent implements OnInit {
  private readonly service = inject(FolderService);
  private readonly users = inject(UserService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly modal = inject(NzModalService);
  private readonly message = inject(NzMessageService);
  private readonly storage = inject(StorageService);

  private readonly params = toSignal(this.route.queryParams, { initialValue: {} as Params });
  readonly folderId = computed<string | null>(() => this.params()['folderId'] ?? null);
  readonly summaryId = computed<string | null>(() => this.params()['summaryId'] ?? null);
  readonly collectionId = computed<string | null>(() => this.params()['collectionId'] ?? null);
  readonly runningId = computed<string | null>(() => this.params()['runningId'] ?? null);

  /** Tree column width (drag the handle; persisted). */
  readonly treeWidth = signal(DEFAULT_WIDTH);

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

  readonly itemOpen = computed(() => !!this.summaryId() || !!this.collectionId() || !!this.runningId());
  /** "Back" label for a summary opened from inside a collection or running summary (name from the loaded tree items). */
  readonly backLabel = computed(() => {
    const id = this.collectionId() ?? this.runningId();
    if (!id) return null;
    const name = [...this.items().values()].flat().find((i) => i._id === id)?.name;
    const what = this.collectionId() ? 'ללקט' : 'לתמצית הרצף';
    return name ? `חזרה ${what} "${name}"` : `חזרה ${what}`;
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
      .subscribe((removedId) => {
        // The open running summary / summary was deleted: show its folder instead.
        if (removedId && (removedId === this.runningId() || removedId === this.summaryId())) this.select(this.folderId());
        this.refresh();
      });
  }

  ngOnInit() {
    this.setWidth(this.storage.get<number>(WIDTH_KEY) ?? DEFAULT_WIDTH);
  }

  // ---- resizable tree ----
  startDrag(e: PointerEvent) {
    const handle = e.target as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = this.treeWidth();
    // RTL: the tree is on the right, so dragging the handle left (smaller clientX) widens it.
    const move = (ev: PointerEvent) => this.setWidth(startW + (startX - ev.clientX));
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      this.storage.set(WIDTH_KEY, this.treeWidth());
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  }

  nudge(delta: number) {
    this.setWidth(this.treeWidth() + delta);
    this.storage.set(WIDTH_KEY, this.treeWidth());
  }

  private setWidth(w: number) {
    const max = Math.max(MIN_WIDTH, window.innerWidth * 0.5);
    this.treeWidth.set(Math.round(Math.max(MIN_WIDTH, Math.min(w, max))));
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

  /** Which query param shows this tree item in the viewer. */
  private paramOf(item: IFolderItem): 'summaryId' | 'collectionId' | 'runningId' {
    if (item.type === 'collection') return 'collectionId';
    return item.kind === SummaryKind.Running ? 'runningId' : 'summaryId';
  }

  isOpen(item: IFolderItem) {
    const param = this.paramOf(item);
    // A summary opened from inside a collection/running summary is not the tree item itself.
    if (param === 'summaryId' && (this.collectionId() || this.runningId())) return false;
    return this.params()[param] === item._id;
  }

  itemParams(folderId: string, item: IFolderItem): Params {
    return { folderId, [this.paramOf(item)]: item._id };
  }

  /** A summary opened from inside a collection / running summary keeps that id in the URL; dropping summaryId shows it again. */
  backToContainer() {
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
        nzData: { parentId: parent?._id ?? null, folders: this.folders() },
        nzFooter: null,
        nzWidth: 480,
      })
      // Reveal the new folder: expand the parent it was created in (picked in the dialog or given) and its ancestors.
      .afterClose.subscribe((created) => {
        for (let f = created?.parentId ? this.byId().get(created.parentId) : undefined; f; f = f.parentId ? this.byId().get(f.parentId) : undefined)
          this.expand(f._id);
      });
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
      if (this.isOpen(item)) this.select(f._id);
    });
  }

  remove(f: IFolder) {
    this.modal.confirm({
      nzTitle: `למחוק את התיקייה "${f.name}"?`,
      nzContent: 'גם תיקיות המשנה שבה יימחקו. הלקטים והתמציות שבתוכה לא יימחקו — הם רק יוצאו מההיררכיה.',
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
