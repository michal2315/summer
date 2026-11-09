import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Params, Router, RouterLink } from '@angular/router';
import { NzDropDownModule } from 'ng-zorro-antd/dropdown';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { debounceTime, distinctUntilChanged, filter, map, of, switchMap } from 'rxjs';
import { UserService } from '../../../core/auth/user.service';
import { InViewDirective } from '../../../shared/components/in-view.directive';
import { ScrollRailComponent } from '../../../shared/components/scroll-rail/scroll-rail.component';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { IFolder, IFolderItem, SearchType, SummaryKind } from '../../../shared/models';
import { FolderService, SUMMARY_DRAG_TYPE } from '../../../shared/services/folder.service';
import { SummaryService } from '../../../shared/services/summary.service';
import type { AddToFolderData } from '../add-to-folder-modal/add-to-folder-modal.component';
import type { FolderEditorData } from '../folder-editor-modal/folder-editor-modal.component';
import { FolderTreeStore, NO_FOLDER } from '../folder-tree.store';

/** A folder's summaries render this many at a time as the tree scrolls. */
const ITEMS_PAGE = 50;
/** Hovering a collapsed folder this long while dragging opens it. */
const DRAG_EXPAND_MS = 700;
/** Drag mode (moving folders and summaries by dragging) is switched off for now: its button is hidden. */
const DRAG_ENABLED = false;
/** Summary titles matching the tree search: at most this many (the server maximum). */
const SEARCH_LIMIT = 100;

/** What is being dragged: a folder, or a summary together with the folder it is in (null = no folder). */
type Dragged = { type: 'folder'; folder: IFolder } | { type: 'summary'; item: IFolderItem; from: string | null };

/**
 * The folder tree in the side nav. Its rows link to the home page (/summaries) with the selection in the query params;
 * the selection is highlighted only while the home page is open.
 */
@Component({
  selector: 'app-folder-tree',
  imports: [NgTemplateOutlet, RouterLink, NzDropDownModule, NzIconModule, NzToolTipModule, InViewDirective, ScrollRailComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './folder-tree.component.html',
  styleUrl: './folder-tree.component.scss',
  host: { '(click)': 'onClick($event)' },
})
export class FolderTreeComponent {
  private readonly service = inject(FolderService);
  private readonly summaries = inject(SummaryService);
  private readonly users = inject(UserService);
  private readonly router = inject(Router);
  private readonly modal = inject(NzModalService);
  private readonly message = inject(NzMessageService);
  readonly store = inject(FolderTreeStore);
  readonly NO_FOLDER = NO_FOLDER;
  readonly DRAG_ENABLED = DRAG_ENABLED;
  /** A link in the tree was followed (the layout closes the overlaid nav on narrow screens). */
  readonly navigate = output<void>();

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.parseUrl(this.router.url)),
    ),
    { initialValue: this.router.parseUrl(this.router.url) },
  );
  readonly onHome = computed(() => this.url().root.children['primary']?.segments.map((s) => s.path).join('/') === 'summaries');
  private readonly params = computed<Params>(() => (this.onHome() ? this.url().queryParams : {}));
  readonly folderId = computed<string | null>(() => this.params()['folderId'] ?? null);
  readonly summaryId = computed<string | null>(() => this.params()['summaryId'] ?? null);
  readonly runningId = computed<string | null>(() => this.params()['runningId'] ?? null);
  private readonly itemOpen = computed(() => !!this.summaryId() || !!this.runningId());

  readonly expanded = signal(new Set<string>());
  /** How many of each folder's items are rendered (default ITEMS_PAGE). */
  private readonly itemsShown = signal(new Map<string, number>());

  // ---- search: folder names (here) and summary titles (server), never content ----
  readonly query = signal('');
  readonly term = computed(() => this.query().trim().toLowerCase());
  /** Summaries in a folder whose title matches, by folder id; null while the server is asked. */
  readonly searchItems = signal<Map<string, IFolderItem[]> | null>(new Map());
  /** While searching: the folders to show (matches, folders holding matching summaries, and their ancestors); null = all. */
  readonly visible = computed(() => {
    const term = this.term();
    if (!term) return null;
    const byId = this.store.byId();
    const show = new Set<string>();
    const reveal = (id: string | null) => {
      for (let f = id ? byId.get(id) : undefined; f && !show.has(f._id); f = f.parentId ? byId.get(f.parentId) : undefined) show.add(f._id);
    };
    for (const f of this.store.folders()) if (f.name.toLowerCase().includes(term)) reveal(f._id);
    for (const id of this.searchItems()?.keys() ?? []) reveal(id);
    return show;
  });

  // ---- drag mode: move folders and summaries by dragging them onto a folder, the root or "no folder" ----
  readonly dragMode = signal(false);
  readonly dragging = signal<Dragged | null>(null);
  /** Folder id, 'root' or NO_FOLDER currently under the pointer as a valid drop target. */
  readonly dropTarget = signal<string | null>(null);
  private hoverTimer?: ReturnType<typeof setTimeout>;
  private hoverId: string | null = null;

  constructor() {
    // Reveal the selected folder (and, when an item is open, its contents) in the tree.
    effect(() => {
      const byId = this.store.byId();
      const path: string[] = [];
      for (let f = byId.get(this.folderId() ?? ''); f; f = f.parentId ? byId.get(f.parentId) : undefined) path.unshift(f._id);
      if (!this.itemOpen()) path.pop();
      untracked(() => path.forEach((id) => this.expand(id)));
    });

    toObservable(this.term)
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((text) => {
          // Only summaries placed in some folder: the tree doesn't list the rest.
          const roots = this.store.children().get(null)?.map((f) => f._id) ?? [];
          if (!text || !roots.length) return of(new Map<string, IFolderItem[]>());
          this.searchItems.set(null);
          const search = { text, searchTypes: [SearchType.Title], folders: roots, kinds: [SummaryKind.Summary, SummaryKind.Running], sort: 'title' as const, limit: SEARCH_LIMIT };
          return this.summaries.search(this.users.userId() ?? '', search).pipe(
            map((res) => {
              const byFolder = new Map<string, IFolderItem[]>();
              // A summary in several folders shows under each of them.
              for (const s of res.summaries)
                for (const f of s.folders) byFolder.set(f._id, [...(byFolder.get(f._id) ?? []), { _id: s._id, name: s.title, kind: s.kind }]);
              return byFolder;
            }),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((items) => this.searchItems.set(items));
  }

  /** The folders under `parent` (null = root) to show: all of them, or while searching only the ones leading to matches. */
  childFolders(parent: string | null): IFolder[] {
    const list = this.store.children().get(parent) ?? [];
    const visible = this.visible();
    return visible ? list.filter((f) => visible.has(f._id)) : list;
  }

  /** A folder name or summary title containing the search term. */
  isMatch(name: string) {
    return !!this.term() && name.toLowerCase().includes(this.term());
  }

  onClick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('a')) this.navigate.emit();
  }

  itemIcon(item: IFolderItem): string {
    return item.kind === SummaryKind.Running ? 'unordered-list' : 'file-text';
  }

  canExpand(f: IFolder) {
    return f.itemCount > 0 || !!this.store.children().get(f._id)?.length;
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
    if (!this.store.items().has(id)) this.store.loadItems(id);
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

  /** The row is the home page's current selection (and no running summary covers its list). */
  isView(id: string | null) {
    return this.onHome() && this.folderId() === id && !this.runningId();
  }

  /** Close every folder. */
  collapseAll() {
    this.expanded.set(new Set());
  }

  // ---- drag mode ----
  toggleDragMode() {
    this.dragMode.update((on) => !on);
    this.endDrag();
  }

  /** Only a folder's managers may move it, and taking it out of its parent needs that parent's managers too. */
  canMove(f: IFolder): boolean {
    const parent = f.parentId ? this.store.byId().get(f.parentId) : null;
    return this.isManager(f) && (!parent || this.isManager(parent));
  }

  /** A summary can leave its folder only with that folder's managers (the server also checks edit rights on it). */
  canMoveSummary(from: string | null): boolean {
    const folder = from ? this.store.byId().get(from) : null;
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

  /** `id` is the folder `ancestorId` or one of its subfolders. */
  private within(id: string | null, ancestorId: string): boolean {
    for (let f = id ? this.store.byId().get(id) : undefined; f; f = f.parentId ? this.store.byId().get(f.parentId) : undefined)
      if (f._id === ancestorId) return true;
    return false;
  }

  /**
   * Where the drag may land (target: a folder id, null = root, NO_FOLDER). A folder goes into a folder you manage (not
   * itself, its subtree or its current parent) or the root. A summary goes into another folder you manage, or out of
   * its folder by dropping it on the root or "no folder".
   */
  private canDrop(target: string | null): boolean {
    const d = this.dragging();
    if (!d) return false;
    const folder = target && target !== NO_FOLDER ? this.store.byId().get(target) : null;
    if (folder && !this.isManager(folder)) return false;
    if (d.type === 'summary') return folder ? folder._id !== d.from : !!d.from;
    if (target === NO_FOLDER || d.folder.parentId === target) return false;
    return !folder || !this.within(folder._id, d.folder._id);
  }

  onDragStart(e: DragEvent, dragged: Dragged) {
    e.stopPropagation();
    e.dataTransfer?.setData('text/plain', dragged.type === 'folder' ? dragged.folder.name : dragged.item.name);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    this.dragging.set(dragged);
  }

  /** A summary card dragged from the feed (not a row of the tree): it can be added to any folder you manage. */
  private isCardDrag(e: DragEvent): boolean {
    return !this.dragging() && !!e.dataTransfer?.types.includes(SUMMARY_DRAG_TYPE);
  }

  private canDropCard(target: string | null): boolean {
    const folder = target && target !== NO_FOLDER ? this.store.byId().get(target) : null;
    return !!folder && this.isManager(folder);
  }

  onDragOver(e: DragEvent, target: string | null) {
    const card = this.isCardDrag(e);
    if (card ? !this.canDropCard(target) : !this.canDrop(target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = card ? 'copy' : 'move';
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
    if (this.isCardDrag(e)) {
      const allowed = this.canDropCard(target);
      this.endDrag();
      if (allowed) this.addCard(this.store.byId().get(target!)!, e.dataTransfer!.getData(SUMMARY_DRAG_TYPE));
      return;
    }
    const d = this.dragging();
    const allowed = this.canDrop(target);
    this.endDrag();
    if (!d || !allowed) return;
    const folder = target && target !== NO_FOLDER ? this.store.byId().get(target)! : null;
    if (d.type === 'folder') {
      this.service.move(d.folder._id, folder?._id ?? null).subscribe(() => {
        this.message.success(`"${d.folder.name}" הועברה אל "${folder?.name ?? 'כל התמציות'}"`);
        if (folder) this.expand(folder._id);
      });
    } else if (folder) {
      this.service.addItems(folder._id, [d.item._id], true).subscribe((r) => {
        if (r.skipped.length) this.message.warning(`אין לך הרשאת עריכה ל"${d.item.name}"`);
        else {
          this.message.success(`"${d.item.name}" נוספה אל "${folder.name}"`);
          this.expand(folder._id);
        }
      });
    } else {
      this.service.removeItems(d.from!, [d.item._id]).subscribe(() => this.message.success(`"${d.item.name}" הוצאה מהתיקייה`));
    }
  }

  /** Add the dropped card's summary to `folder`, keeping the folders it is already in. */
  private addCard(folder: IFolder, data: string) {
    let s: { _id: string; title: string };
    try {
      s = JSON.parse(data);
    } catch {
      return;
    }
    this.service.addItems(folder._id, [s._id], true).subscribe((r) => {
      const reason = r.skipped[0]?.reason;
      if (reason === 'draft') this.message.warning('טיוטות לא נכנסות לתיקיות');
      else if (reason === 'sumaroon') this.message.warning('תמציתונית נמצאת רק בתוך תמצית הרצף שלה');
      else if (reason) this.message.warning(`אין לך הרשאת עריכה ל"${s.title}"`);
      else {
        this.message.success(`"${s.title}" נוספה אל "${folder.name}"`);
        this.expand(folder._id);
      }
    });
  }

  endDrag() {
    this.dragging.set(null);
    this.dropTarget.set(null);
    clearTimeout(this.hoverTimer);
    this.hoverId = null;
  }

  private select(folderId: string | null) {
    this.router.navigate(['/summaries'], { queryParams: { folderId } });
  }

  // The folder modals are lazy-loaded so they stay out of the initial bundle (the side nav is in it).
  async create(parent: IFolder | null) {
    const { FolderEditorModalComponent } = await import('../folder-editor-modal/folder-editor-modal.component');
    this.modal
      .create<InstanceType<typeof FolderEditorModalComponent>, FolderEditorData, IFolder>({
        nzTitle: parent ? `תיקיית משנה ב"${parent.name}"` : 'תיקייה חדשה',
        nzContent: FolderEditorModalComponent,
        nzData: { parentId: parent?._id ?? null, folders: this.store.folders() },
        nzFooter: null,
        nzWidth: 480,
      })
      // Reveal the new folder: expand the parent it was created in (picked in the dialog or given) and its ancestors.
      .afterClose.subscribe((created) => {
        const byId = this.store.byId();
        for (let f = created?.parentId ? byId.get(created.parentId) : undefined; f; f = f.parentId ? byId.get(f.parentId) : undefined) this.expand(f._id);
      });
  }

  async edit(f: IFolder) {
    const { FolderEditorModalComponent } = await import('../folder-editor-modal/folder-editor-modal.component');
    this.modal.create<InstanceType<typeof FolderEditorModalComponent>, FolderEditorData, IFolder>({
      nzTitle: 'עריכת תיקייה',
      nzContent: FolderEditorModalComponent,
      nzData: { folder: f },
      nzFooter: null,
      nzWidth: 480,
    });
  }

  async addItems(f: IFolder) {
    const { AddToFolderModalComponent } = await import('../add-to-folder-modal/add-to-folder-modal.component');
    this.modal
      .create<InstanceType<typeof AddToFolderModalComponent>, AddToFolderData, boolean>({
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
        new Promise<void>((resolve, reject) => {
          // The home page shows the deleted folder (or one inside it): move it to the parent.
          const shown = this.onHome() && this.within(this.folderId(), f._id);
          this.service.delete(f._id).subscribe({
            next: () => {
              this.message.success('התיקייה נמחקה');
              if (shown) this.select(f.parentId);
              resolve();
            },
            error: reject,
          });
        }),
    });
  }
}
