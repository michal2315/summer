import { Location, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, output, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Params, Router, RouterLink } from '@angular/router';
import { NzContextMenuService, NzDropDownModule, NzDropdownMenuComponent } from 'ng-zorro-antd/dropdown';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { filter, map, Observable, of, switchMap, tap } from 'rxjs';
import { UserService } from '../../../core/auth/user.service';
import { InViewDirective } from '../../../shared/components/in-view.directive';
import { ScrollRailComponent } from '../../../shared/components/scroll-rail/scroll-rail.component';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { IFolder, IFolderItem, SummaryKind } from '../../../shared/models';
import { highlightText, searchRegex } from '../../../shared/pipes/highlight';
import { FolderService, SUMMARY_DRAG_TYPE } from '../../../shared/services/folder.service';
import type { AddToFolderData } from '../add-to-folder-modal/add-to-folder-modal.component';
import type { FolderEditorData } from '../folder-editor-modal/folder-editor-modal.component';
import { FolderTreeStore, NO_FOLDER } from '../folder-tree.store';
import { searchParamsOf } from '../../summaries/search-query';
import { PreferencesService } from '../../../core/preferences/preferences.service';

/** A folder's summaries render this many at a time as the tree scrolls. */
const ITEMS_PAGE = 50;
/** Hovering a collapsed folder this long while dragging a card opens it. */
const DRAG_EXPAND_MS = 700;
/** How long the "moved" toast (with its undo) stays. */
const UNDO_MS = 6000;
/** How long the "undone" toast stays. */
const UNDONE_MS = 2500;
/** How long a row that just moved stays highlighted. */
const LANDED_MS = 1200;

/** What is being moved: a folder, or a summary together with the folder it is in (null = no folder). */
type Moving = { type: 'folder'; folder: IFolder } | { type: 'summary'; item: IFolderItem; from: string | null };
/** The tree's toast; `undo` puts a move back. */
type Toast = { text: string; undo?: () => Observable<unknown> };

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
  host: { '(click)': 'onClick($event)', '(document:keydown.escape)': 'cancelMove()' },
})
export class FolderTreeComponent {
  private readonly service = inject(FolderService);
  private readonly users = inject(UserService);
  private readonly router = inject(Router);
  private readonly modal = inject(NzModalService);
  private readonly message = inject(NzMessageService);
  private readonly contextMenu = inject(NzContextMenuService);
  private readonly location = inject(Location);
  private readonly host = inject(ElementRef);
  readonly store = inject(FolderTreeStore);
  private readonly prefs = inject(PreferencesService);
  readonly NO_FOLDER = NO_FOLDER;
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
  /** The home page's search, kept when moving to another folder. */
  private readonly searchParams = computed(() => searchParamsOf(this.params()));

  /**
   * Query params for a link from the tree: `p` plus the current search. Moving to another folder drops the search when
   * the user prefers that (preferences); staying in the folder (e.g. opening one of its summaries) always keeps it.
   */
  withSearch(p: Params = {}): Params {
    const sameFolder = (p['folderId'] ?? null) === this.folderId();
    const keep = sameFolder || this.prefs.keepSearchAcrossFolders();
    return { ...(keep ? this.searchParams() : {}), ...p };
  }

  readonly expanded = signal(new Set<string>());
  /** How many of each folder's items are rendered (default ITEMS_PAGE). */
  private readonly itemsShown = signal(new Map<string, number>());

  // ---- search: folder names only ----
  readonly query = signal('');
  readonly term = computed(() => this.query().trim().toLowerCase());
  /** While searching: the folders to show (matches and their ancestors); null = all. */
  readonly visible = computed(() => {
    const term = this.term();
    if (!term) return null;
    const byId = this.store.byId();
    const show = new Set<string>();
    const reveal = (id: string | null) => {
      for (let f = id ? byId.get(id) : undefined; f && !show.has(f._id); f = f.parentId ? byId.get(f.parentId) : undefined) show.add(f._id);
    };
    for (const f of this.store.folders()) if (f.name.toLowerCase().includes(term)) reveal(f._id);
    return show;
  });

  // ---- moving (see "moving" below) ----
  /** The folder or summary picked up to move; while set, clicking a row puts it there instead of opening it. */
  readonly moving = signal<Moving | null>(null);
  /** The row that just landed somewhere (briefly highlighted). */
  readonly landed = signal<string | null>(null);
  private landTimer?: ReturnType<typeof setTimeout>;
  /** The toast on screen ("moved x to y" with its undo, or "undone"), and where it sits (over the side nav's top). */
  readonly toast = signal<Toast | null>(null);
  readonly toastBox = signal({ top: 0, left: 0, width: 0 });
  private toastTimer?: ReturnType<typeof setTimeout>;
  private toastMs = UNDO_MS;
  /** The row the right-click menu is open for. */
  readonly menuFor = signal<Moving | null>(null);
  private readonly rowMenu = viewChild.required<NzDropdownMenuComponent>('rowMenu');

  // ---- a summary card dragged from the feed onto a folder ----
  /** Folder id currently under the pointer as a valid drop target. */
  readonly dropTarget = signal<string | null>(null);
  private hoverTimer?: ReturnType<typeof setTimeout>;
  private hoverId: string | null = null;

  constructor() {
    // Open the selected folder and its ancestors in the tree. Moving up to an ancestor (a breadcrumb, "all summaries")
    // closes the folders between it and the folder that was selected.
    let prev: string | null | undefined;
    effect(() => {
      const byId = this.store.byId();
      const id = this.folderId();
      if (!this.onHome()) return;
      const pathOf = (from: string | null) => {
        const path: string[] = [];
        for (let f = from ? byId.get(from) : undefined; f; f = f.parentId ? byId.get(f.parentId) : undefined) path.unshift(f._id);
        return path;
      };
      const path = pathOf(id);
      const before = prev && prev !== id ? pathOf(prev) : [];
      prev = id;
      // Where `id` sits on the previous folder's path (null = the root, above every folder); -1 = not an ancestor.
      const at = id === null ? -1 : before.indexOf(id);
      const below = id === null || at >= 0 ? before.slice(at + 1) : [];
      untracked(() => {
        if (below.length) this.collapse(below);
        path.forEach((f) => this.expand(f));
      });
    });
  }

  /** The folders under `parent` (null = root) to show: all of them, or while searching only the ones leading to matches. */
  childFolders(parent: string | null): IFolder[] {
    // The legacy root shows only while it holds collections you can see.
    const list = (this.store.children().get(parent) ?? []).filter((f) => f.legacy !== 'root' || !!this.store.children().get(f._id)?.length);
    const visible = this.visible();
    return visible ? list.filter((f) => visible.has(f._id)) : list;
  }

  /** The tree search as a highlight regex (same matching as the feed's highlights). */
  private readonly searchRe = computed(() => searchRegex(this.term()));

  /** A folder name as escaped HTML with the search hits highlighted. */
  mark(name: string) {
    return highlightText(name, this.searchRe());
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

  private collapse(ids: string[]) {
    this.expanded.update((s) => {
      const next = new Set(s);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }

  toggle(id: string) {
    if (this.expanded().has(id)) this.collapse([id]);
    else this.expand(id);
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
    return this.withSearch({ folderId, [this.paramOf(item)]: item._id });
  }

  /** The row is the home page's current selection (and no running summary covers its list). */
  isView(id: string | null) {
    return this.onHome() && this.folderId() === id && !this.runningId();
  }

  /** Close every folder. */
  collapseAll() {
    this.expanded.set(new Set());
  }

  // ---- moving: pick a folder or summary up from its right-click menu, then click where it goes ----
  /**
   * Only a folder's managers may move it, and taking it out of its parent needs that parent's managers too. The legacy
   * collections move on the staging page (where moving one out can be undone).
   */
  canMove(f: IFolder): boolean {
    const parent = f.parentId ? this.store.byId().get(f.parentId) : null;
    return this.isManager(f) && !f.legacy && (!parent || this.isManager(parent));
  }

  /**
   * Only your own summaries can be moved in the tree, and taking one out of its folder needs that folder's managers.
   * Summaries in a legacy collection are sorted on the staging page instead.
   */
  canMoveSummary(item: IFolderItem, from: string | null): boolean {
    const folder = from ? this.store.byId().get(from) : null;
    return item.mine && (!from || (!!folder && this.canAddTo(folder)));
  }

  /** A folder you manage that things can be added to (not the legacy root or a collection in it). */
  canAddTo(f: IFolder): boolean {
    return this.isManager(f) && !f.legacy;
  }

  /** The row is the one picked up (lifted). A summary row is the lifted one only in the folder it was picked from. */
  isLifted(id: string, from?: string | null) {
    const m = this.moving();
    return m?.type === 'folder' ? m.folder._id === id && from === undefined : m?.type === 'summary' && m.item._id === id && m.from === from;
  }

  /** `id` is the folder `ancestorId` or one of its subfolders. */
  private within(id: string | null, ancestorId: string): boolean {
    for (let f = id ? this.store.byId().get(id) : undefined; f; f = f.parentId ? this.store.byId().get(f.parentId) : undefined)
      if (f._id === ancestorId) return true;
    return false;
  }

  /**
   * Where the picked-up row may go (target: a folder id, null = root, NO_FOLDER). A folder goes into a folder you
   * manage (not itself, its subtree or its current parent) or the root. A summary goes into another folder you manage,
   * or out of its folder via the root or "no folder".
   */
  canPlace(target: string | null): boolean {
    const m = this.moving();
    if (!m) return false;
    const folder = target && target !== NO_FOLDER ? this.store.byId().get(target) : null;
    if (folder && !this.canAddTo(folder)) return false;
    if (m.type === 'summary') return folder ? folder._id !== m.from : !!m.from;
    if (target === NO_FOLDER || m.folder.parentId === target) return false;
    return !folder || !this.within(folder._id, m.folder._id);
  }

  startMove(moving: Moving) {
    this.contextMenu.close();
    this.moving.set(moving);
  }

  cancelMove() {
    this.moving.set(null);
  }

  /**
   * A click on a row's link while moving: put the lifted row there (a valid target), or put it back (itself).
   * `target` undefined: the row is never a target (a summary row).
   */
  onPlaceClick(e: MouseEvent, target: string | null | undefined, self = false) {
    if (!this.moving()) return;
    e.preventDefault();
    e.stopPropagation();
    if (self) this.cancelMove();
    else if (target !== undefined && this.canPlace(target)) this.place(target);
  }

  private place(target: string | null) {
    const m = this.moving()!;
    this.moving.set(null);
    const folder = target && target !== NO_FOLDER ? this.store.byId().get(target)! : null;
    if (m.type === 'folder') {
      const back = m.folder.parentId;
      this.service.move(m.folder._id, folder?._id ?? null).subscribe(() => {
        if (folder) this.expand(folder._id);
        this.land(m.folder._id);
        this.toastMoved(`"${m.folder.name}" הועברה אל "${folder?.name ?? 'כל התמציות'}"`, () =>
          this.service.move(m.folder._id, back).pipe(tap(() => back && this.expand(back))),
        );
      });
      return;
    }
    const { item, from } = m;
    if (!folder) {
      this.service.removeItems(from!, [item._id]).subscribe(() => {
        if (this.isOpen(item)) this.select(from);
        this.toastMoved(`"${item.name}" הוצאה מהתיקייה`, () => this.service.addItems(from!, [item._id], true));
      });
      return;
    }
    // A move: place it in the target, then take it out of the folder it came from. Undo reverses both (but leaves it
    // in the target when it was there already).
    const wasThere = !!this.store.items().get(folder._id)?.some((i) => i._id === item._id);
    this.service.addItems(folder._id, [item._id], true).subscribe((r) => {
      if (r.skipped.length) return void this.message.warning(`לא ניתן להעביר את "${item.name}"`);
      const done = () => {
        this.expand(folder._id);
        this.land(item._id);
        this.toastMoved(`"${item.name}" הועברה אל "${folder.name}"`, () => {
          const restore: Observable<unknown> = from ? this.service.addItems(from, [item._id], true) : of(null);
          return restore.pipe(switchMap(() => (wasThere ? of(null) : this.service.removeItems(folder._id, [item._id]))));
        });
      };
      if (from) this.service.removeItems(from, [item._id]).subscribe(done);
      else done();
    });
  }

  /** Briefly mark the row that just landed. */
  private land(id: string) {
    clearTimeout(this.landTimer);
    this.landed.set(id);
    this.landTimer = setTimeout(() => this.landed.set(null), LANDED_MS);
  }

  /** "Moved x to y" with an undo button, for UNDO_MS. */
  private toastMoved(text: string, undo: () => Observable<unknown>) {
    this.showToast({ text, undo }, UNDO_MS);
  }

  /**
   * Show the toast over the top of the side nav (the tree's nav; the tree itself if it has none). It is fixed so it
   * floats above the nav's logo and profile card, placed from the nav's box when shown.
   */
  private showToast(toast: Toast, ms: number) {
    const host = this.host.nativeElement as HTMLElement;
    const r = (host.closest('[role="navigation"]') ?? host).getBoundingClientRect();
    this.toastBox.set({ top: r.top + 8, left: r.left + 8, width: r.width - 16 });
    this.toast.set(toast);
    this.toastMs = ms;
    this.resumeToast();
  }

  /** Hovering the toast keeps it up; leaving it gives it its full time again. */
  pauseToast() {
    clearTimeout(this.toastTimer);
  }

  resumeToast() {
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), this.toastMs);
  }

  closeToast() {
    clearTimeout(this.toastTimer);
    this.toast.set(null);
  }

  undoMove() {
    const undo = this.toast()?.undo;
    if (!undo) return;
    this.closeToast();
    undo().subscribe(() => this.showToast({ text: 'ההעברה בוטלה' }, UNDONE_MS));
  }

  // ---- right-click menu (every folder and summary row; the options depend on what you may do) ----
  onContextMenu(e: MouseEvent, target: Moving) {
    e.preventDefault();
    if (this.moving()) return;
    this.menuFor.set(target);
    this.contextMenu.create(e, this.rowMenu());
  }

  /** Taking a summary out of its folder needs that folder's managers (the summary needn't be yours). */
  canTakeOut(from: string | null): boolean {
    const folder = from ? this.store.byId().get(from) : null;
    return !!folder && this.canAddTo(folder);
  }

  /** The home-page URL that shows the row (a folder, or a summary inside its folder). */
  private rowUrl(t: Moving): string {
    const params = t.type === 'folder' ? this.withSearch({ folderId: t.folder._id }) : this.itemParams(t.from!, t.item);
    return this.router.serializeUrl(this.router.createUrlTree(['/summaries'], { queryParams: params }));
  }

  openInNewTab(t: Moving) {
    window.open(this.location.prepareExternalUrl(this.rowUrl(t)), '_blank', 'noopener');
  }

  async copyLink(t: Moving) {
    try {
      await navigator.clipboard.writeText(new URL(this.location.prepareExternalUrl(this.rowUrl(t)), window.location.origin).href);
      this.message.success('הקישור הועתק');
    } catch {
      this.message.error('לא ניתן להעתיק את הקישור');
    }
  }

  /** A card dragged from the feed (see SUMMARY_DRAG_TYPE). */
  private isCardDrag(e: DragEvent): boolean {
    return !!e.dataTransfer?.types.includes(SUMMARY_DRAG_TYPE);
  }

  private canDropCard(target: string): boolean {
    const folder = this.store.byId().get(target);
    return !!folder && this.canAddTo(folder);
  }

  onDragOver(e: DragEvent, target: string) {
    if (!this.isCardDrag(e) || !this.canDropCard(target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    this.dropTarget.set(target);
    // Hovering a closed folder opens it, so a drop can reach its subfolders.
    if (target !== this.hoverId) {
      clearTimeout(this.hoverTimer);
      this.hoverId = target;
      this.hoverTimer = setTimeout(() => this.expand(target), DRAG_EXPAND_MS);
    }
  }

  onDragLeave(e: DragEvent) {
    if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) return;
    this.endDrag();
  }

  onDrop(e: DragEvent, target: string) {
    e.preventDefault();
    e.stopPropagation();
    const allowed = this.isCardDrag(e) && this.canDropCard(target);
    this.endDrag();
    if (allowed) this.addCard(this.store.byId().get(target)!, e.dataTransfer!.getData(SUMMARY_DRAG_TYPE));
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
      else if (reason) this.message.warning(`"${s.title}" לא נמצאה`);
      else {
        this.message.success(`"${s.title}" נוספה אל "${folder.name}"`);
        this.expand(folder._id);
      }
    });
  }

  endDrag() {
    this.dropTarget.set(null);
    clearTimeout(this.hoverTimer);
    this.hoverId = null;
  }

  /** The staging page, where the legacy collections are sorted into folders. */
  openStaging() {
    this.contextMenu.close();
    this.navigate.emit();
    this.router.navigate(['/staging']);
  }

  private select(folderId: string | null) {
    this.router.navigate(['/summaries'], { queryParams: this.withSearch({ folderId }) });
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

  removeFrom(folderId: string, item: IFolderItem) {
    const f = this.store.byId().get(folderId);
    if (f) this.removeItem(f, item);
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
