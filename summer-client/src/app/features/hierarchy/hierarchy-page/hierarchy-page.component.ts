import { NgTemplateOutlet } from '@angular/common';
import { AltKeyDirective } from '../../../shared/keyboard/alt-key.directive';
import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzDropDownModule } from 'ng-zorro-antd/dropdown';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { merge } from 'rxjs';
import { UserService } from '../../../core/auth/user.service';
import { StorageService } from '../../../core/storage/storage.service';
import { InViewDirective } from '../../../shared/components/in-view.directive';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { IFolder, IFolderItem, ISummarySearch, SummaryKind } from '../../../shared/models';
import { FolderService } from '../../../shared/services/folder.service';
import { SummaryService } from '../../../shared/services/summary.service';
import { RunningPageComponent } from '../../running/running-page/running-page.component';
import { SummaryBrowserComponent } from '../../summaries/summary-browser/summary-browser.component';
import { EmptyState } from '../../summaries/summary-list/summary-list.component';
import { SummaryDetailComponent } from '../../summaries/summary-detail/summary-detail.component';
import { AddToFolderData, AddToFolderModalComponent } from '../add-to-folder-modal/add-to-folder-modal.component';
import { FolderEditorData, FolderEditorModalComponent } from '../folder-editor-modal/folder-editor-modal.component';

const byName = (a: IFolder, b: IFolder) => a.name.localeCompare(b.name, 'he');

/** `folderId` value of the "no folder" view; no `folderId` at all is the root (every summary). */
export const NO_FOLDER = 'none';
/** The tree lists regular and running summaries (a sumaroon lives inside its running summary). */
const KINDS = [SummaryKind.Summary, SummaryKind.Running];
/** The tree lists every unfiled summary, fetched this many at a time (the server maximum). */
const UNFILED_PAGE = 100;
/** A folder's summaries render this many at a time as the tree scrolls. */
const ITEMS_PAGE = 50;
/** Hovering a collapsed folder this long while dragging opens it. */
const DRAG_EXPAND_MS = 700;

/** What is being dragged: a folder, or a summary together with the folder it is in (null = no folder). */
type Dragged = { type: 'folder'; folder: IFolder } | { type: 'summary'; item: IFolderItem; from: string | null };

const WIDTH_KEY = 'hierarchyTreeWidth';
const MIN_WIDTH = 200;
const DEFAULT_WIDTH = 300;

/**
 * Home page (/summaries): folder tree beside the summaries list. The list and its search cover the selection: every
 * summary (root), a folder with its subfolders, or NO_FOLDER. Query params: folderId = the selection (none = root);
 * summaryId = the summary open in the list's side panel (or, under a running summary, in the viewer); runningId = a
 * running summary shown in the viewer instead of the list.
 */
@Component({
  selector: 'app-hierarchy-page',
  imports: [
    AltKeyDirective,
    NgTemplateOutlet,
    RouterLink,
    NzButtonModule,
    NzDropDownModule,
    NzIconModule,
    NzToolTipModule,
    InViewDirective,
    SkeletonComponent,
    RunningPageComponent,
    SummaryBrowserComponent,
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
  private readonly summaries = inject(SummaryService);
  readonly NO_FOLDER = NO_FOLDER;
  readonly userId = computed(() => this.users.userId() ?? '');

  private readonly params = toSignal(this.route.queryParams, { initialValue: {} as Params });
  readonly folderId = computed<string | null>(() => this.params()['folderId'] ?? null);
  readonly summaryId = computed<string | null>(() => this.params()['summaryId'] ?? null);
  readonly runningId = computed<string | null>(() => this.params()['runningId'] ?? null);

  /** Tree column width (drag the handle; persisted). */
  readonly treeWidth = signal(DEFAULT_WIDTH);

  readonly folders = signal<IFolder[]>([]);
  readonly treeLoaded = signal(false);
  readonly expanded = signal(new Set<string>());
  /** Items of each expanded folder, loaded on first expand. */
  readonly items = signal(new Map<string, IFolderItem[]>());
  /** How many of each folder's items are rendered (default ITEMS_PAGE). */
  private readonly itemsShown = signal(new Map<string, number>());

  readonly byId = computed(() => new Map(this.folders().map((f) => [f._id, f])));
  /** parentId (null = root) → child folders, sorted by name. */
  readonly children = computed(() => {
    const map = new Map<string | null, IFolder[]>();
    for (const f of this.folders()) map.set(f.parentId, [...(map.get(f.parentId) ?? []), f]);
    for (const list of map.values()) list.sort(byName);
    return map;
  });

  /** Summaries in no folder: the first few by title (shown in the tree under the root) and how many there are. */
  readonly unfiled = signal<{ items: IFolderItem[]; total: number } | null>(null);

  readonly itemOpen = computed(() => !!this.summaryId() || !!this.runningId());
  /** The selected folder, when the selection is a real folder. */
  readonly folder = computed(() => this.byId().get(this.folderId() ?? '') ?? null);
  readonly viewTitle = computed(() => (this.folderId() === NO_FOLDER ? 'ללא תיקייה' : (this.folder()?.name ?? 'כל התמציות')));
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
    const id = this.runningId();
    const name = [...this.items().values(), this.unfiled()?.items ?? []].flat().find((i) => i._id === id)?.name;
    return name ? `חזרה לתמצית הרצף "${name}"` : 'חזרה לתמצית הרצף';
  });

  /** The "no folder" heading is expanded (its summaries listed under it). */
  readonly unfiledOpen = signal(true);

  // ---- drag mode: move folders and summaries by dragging them onto a folder, the root or "no folder" ----
  readonly dragMode = signal(false);
  readonly dragging = signal<Dragged | null>(null);
  /** Folder id, 'root' or NO_FOLDER currently under the pointer as a valid drop target. */
  readonly dropTarget = signal<string | null>(null);
  private hoverTimer?: ReturnType<typeof setTimeout>;
  private hoverId: string | null = null;

  constructor() {
    this.loadTree();
    this.loadUnfiled();
    // Reveal the selected folder (and, when an item is open, its contents) in the tree.
    effect(() => {
      const byId = this.byId();
      const path: string[] = [];
      for (let f = byId.get(this.folderId() ?? ''); f; f = f.parentId ? byId.get(f.parentId) : undefined) path.unshift(f._id);
      if (!this.itemOpen()) path.pop();
      untracked(() => path.forEach((id) => this.expand(id)));
    });
    merge(this.service.changed$, this.summaries.removed$)
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
    // Leaves the list and the summary side panel room to sit beside it.
    const max = Math.max(MIN_WIDTH, Math.min(window.innerWidth * 0.3, 480));
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

  /** Every unfiled summary, a page at a time (shown as the pages arrive). */
  private loadUnfiled(skip = 0, loaded: IFolderItem[] = []) {
    this.summaries
      .search(this.users.userId() ?? '', { noFolder: true, kinds: KINDS, sort: 'title', limit: UNFILED_PAGE, skip })
      .subscribe((res) => {
        const items = [...loaded, ...res.summaries.map((s) => ({ _id: s._id, name: s.title, kind: s.kind }))];
        this.unfiled.set({ items, total: res.lengths.summary });
        if (res.summaries.length === UNFILED_PAGE && items.length < res.lengths.summary) this.loadUnfiled(items.length, items);
      });
  }

  private loadItems(folderId: string) {
    this.service.items(folderId).subscribe((list) => this.items.update((m) => new Map(m).set(folderId, list)));
  }

  /** After a mutation: reload the tree and the items of every loaded folder. */
  private refresh() {
    this.loadTree();
    this.loadUnfiled();
    for (const id of this.items().keys()) this.loadItems(id);
    this.refreshTick.update((t) => t + 1);
  }

  itemIcon(item: IFolderItem): string {
    return item.kind === SummaryKind.Running ? 'unordered-list' : 'file-text';
  }

  canExpand(f: IFolder) {
    return f.itemCount > 0 || !!this.children().get(f._id)?.length;
  }

  isManager(f: IFolder) {
    return f.managers.includes(this.users.userId() ?? '');
  }

  shownCount(folderId: string): number {
    return this.itemsShown().get(folderId) ?? ITEMS_PAGE;
  }

  showMoreItems(folderId: string) {
    this.itemsShown.update((m) => new Map(m).set(folderId, this.shownCount(folderId) + ITEMS_PAGE));
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
  private paramOf(item: IFolderItem): 'summaryId' | 'runningId' {
    return item.kind === SummaryKind.Running ? 'runningId' : 'summaryId';
  }

  isOpen(item: IFolderItem) {
    const param = this.paramOf(item);
    // A summary opened from inside a running summary is not the tree item itself.
    if (param === 'summaryId' && this.runningId()) return false;
    return this.params()[param] === item._id;
  }

  itemParams(folderId: string, item: IFolderItem): Params {
    return { folderId, [this.paramOf(item)]: item._id };
  }

  /** Back from a summary opened inside a running summary (still in the URL) to that running summary. */
  backToContainer() {
    this.router.navigate([], { relativeTo: this.route, queryParams: { summaryId: null }, queryParamsHandling: 'merge' });
  }

  /** Back from an open running summary to the selection's list. */
  backToList() {
    this.router.navigate([], { relativeTo: this.route, queryParams: { runningId: null, summaryId: null }, queryParamsHandling: 'merge' });
  }

  /** The row is the current selection (and no running summary covers its list). */
  isView(id: string | null) {
    return this.folderId() === id && !this.runningId();
  }

  /** Close every folder and the "no folder" heading. */
  collapseAll() {
    this.expanded.set(new Set());
    this.unfiledOpen.set(false);
  }

  // ---- drag mode ----
  toggleDragMode() {
    this.dragMode.update((on) => !on);
    this.endDrag();
  }

  /** Only a folder's managers may move it, and taking it out of its parent needs that parent's managers too. */
  canMove(f: IFolder): boolean {
    const parent = f.parentId ? this.byId().get(f.parentId) : null;
    return this.isManager(f) && (!parent || this.isManager(parent));
  }

  /** A summary can leave its folder only with that folder's managers (the server also checks edit rights on it). */
  canMoveSummary(from: string | null): boolean {
    const folder = from ? this.byId().get(from) : null;
    return !from || (!!folder && this.isManager(folder));
  }

  /** The current drag being the dragged summary row (for the dimmed look). */
  isDraggingItem(id: string) {
    const d = this.dragging();
    return d?.type === 'summary' && d.item._id === id;
  }

  isDraggingFolder(id: string) {
    const d = this.dragging();
    return d?.type === 'folder' && d.folder._id === id;
  }

  /**
   * Where the drag may land (target: a folder id, null = root, NO_FOLDER). A folder goes into a folder you manage (not
   * itself, its subtree or its current parent) or the root. A summary goes into another folder you manage, or out of
   * its folder by dropping it on the root or "no folder".
   */
  private canDrop(target: string | null): boolean {
    const d = this.dragging();
    if (!d) return false;
    const folder = target && target !== NO_FOLDER ? this.byId().get(target) : null;
    if (folder && !this.isManager(folder)) return false;
    if (d.type === 'summary') return folder ? folder._id !== d.from : !!d.from;
    if (target === NO_FOLDER || d.folder.parentId === target) return false;
    for (let f = folder; f; f = f.parentId ? this.byId().get(f.parentId) : null) if (f._id === d.folder._id) return false;
    return true;
  }

  onDragStart(e: DragEvent, dragged: Dragged) {
    e.stopPropagation();
    e.dataTransfer?.setData('text/plain', dragged.type === 'folder' ? dragged.folder.name : dragged.item.name);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    this.dragging.set(dragged);
  }

  onDragOver(e: DragEvent, target: string | null) {
    if (!this.canDrop(target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    this.dropTarget.set(target ?? 'root');
    // Hovering a closed folder opens it, so a drop can reach its subfolders.
    if (target && target !== NO_FOLDER && target !== this.hoverId) {
      clearTimeout(this.hoverTimer);
      this.hoverId = target;
      this.hoverTimer = setTimeout(() => this.expand(target), DRAG_EXPAND_MS);
    }
  }

  onDragLeave(e: DragEvent) {
    if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) return;
    this.dropTarget.set(null);
    clearTimeout(this.hoverTimer);
    this.hoverId = null;
  }

  onDrop(e: DragEvent, target: string | null) {
    e.preventDefault();
    e.stopPropagation();
    const d = this.dragging();
    const allowed = this.canDrop(target);
    this.endDrag();
    if (!d || !allowed) return;
    const folder = target && target !== NO_FOLDER ? this.byId().get(target)! : null;
    if (d.type === 'folder') {
      this.service.move(d.folder._id, folder?._id ?? null).subscribe(() => {
        this.message.success(`"${d.folder.name}" הועברה אל "${folder?.name ?? 'כל התמציות'}"`);
        if (folder) this.expand(folder._id);
      });
    } else if (folder) {
      this.service.addItems(folder._id, [d.item._id], true).subscribe((r) => {
        if (r.skipped.length) this.message.warning(`אין לך הרשאת עריכה ל"${d.item.name}"`);
        else {
          this.message.success(`"${d.item.name}" הועברה אל "${folder.name}"`);
          this.expand(folder._id);
        }
      });
    } else {
      this.service.removeItems(d.from!, [d.item._id]).subscribe(() => this.message.success(`"${d.item.name}" הוצאה מהתיקייה`));
    }
  }

  endDrag() {
    this.dragging.set(null);
    this.dropTarget.set(null);
    clearTimeout(this.hoverTimer);
    this.hoverId = null;
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
    this.service.removeItems(f._id, [item._id]).subscribe(() => {
      this.message.success(`"${item.name}" הוצא מהתיקייה`);
      if (this.isOpen(item)) this.select(f._id);
    });
  }

  remove(f: IFolder) {
    this.modal.confirm({
      nzTitle: `למחוק את התיקייה "${f.name}"?`,
      nzContent: 'גם תיקיות המשנה שבה יימחקו. התמציות שבתוכה לא יימחקו — הן רק יוצאו מההיררכיה.',
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
