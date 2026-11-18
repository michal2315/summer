import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzDropDownModule } from 'ng-zorro-antd/dropdown';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { Observable, forkJoin, map, of, switchMap } from 'rxjs';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { UndoToast, UndoToastComponent } from '../../../shared/components/undo-toast/undo-toast.component';
import { IFolder, ILegacyCollection, ILegacyItem, ILegacyOverview, ILegacySorted, IPermission, ISummarySearch, SummaryKind } from '../../../shared/models';
import { FolderService } from '../../../shared/services/folder.service';
import { LegacyService } from '../../../shared/services/legacy.service';
import { FolderTreeStore } from '../../hierarchy/folder-tree.store';
import { summaryPageLink } from '../../../shared/utils/summary-links';
import { alertSearch } from '../../summaries/search-query';
import { SummarySearchComponent } from '../../summaries/summary-search/summary-search.component';
import { NO_FOLDER_TARGET, StagingTreeComponent } from '../staging-tree/staging-tree.component';
import { SunProgressComponent } from '../sun-progress/sun-progress.component';

/** How long the "moved" toast (with its undo) stays. */
const UNDO_MS = 8000;
/** How long the "undone" toast stays. */
const UNDONE_MS = 2500;
/** How long a folder that just received something stays highlighted. */
const LANDED_MS = 1200;
/** Collections with more summaries than this get a filter box. */
const FILTER_FROM = 8;

/** What is being dragged from the collections onto the tree. */
type Drag = { kind: 'items' } | { kind: 'collection'; collection: ILegacyCollection };

/**
 * Staging (temporary, /staging): sorting the collections from the old Summer, each a flat folder in the legacy root,
 * into the new hierarchy. The collections you manage are on one side and the folder tree on the other; summaries (or
 * whole collections) only move out of the legacy root. Sorting is shared: whatever a manager moves is moved for all.
 */
@Component({
  selector: 'app-staging-page',
  imports: [NgTemplateOutlet, RouterLink,NzButtonModule, NzCheckboxModule, NzDropDownModule, NzIconModule, NzToolTipModule, SkeletonComponent, StagingTreeComponent, SummarySearchComponent, SunProgressComponent, UndoToastComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './staging-page.component.html',
  styleUrl: './staging-page.component.scss',
  host: { '(document:keydown.escape)': 'clearSelection()' },
})
export class StagingPageComponent {
  private readonly legacy = inject(LegacyService);
  private readonly folders = inject(FolderService);
  private readonly store = inject(FolderTreeStore);
  private readonly message = inject(NzMessageService);
  private readonly modal = inject(NzModalService);

  readonly overview = signal<ILegacyOverview | null>(null);
  /**
   * The user's unfiled summaries (a section like a collection, first), the collections they manage, then their own
   * summaries in collections others manage (one section each).
   */
  readonly collections = computed(() => {
    const o = this.overview();
    return o ? [...(o.unfiled ? [o.unfiled] : []), ...o.collections, ...o.authored] : [];
  });
  /** Collections others manage, by id, with their managers. */
  private readonly authored = computed(() => new Map((this.overview()?.authored ?? []).map((a) => [a.folder._id, a])));
  /** The first shown collection of others: the "my summaries in others' collections" heading goes above it. */
  readonly firstAuthored = computed(() => this.shownCollections().find((c) => this.authored().has(c.folder._id))?.folder._id ?? null);
  /** Nothing to sort here at all (no collections ever, no unfiled summaries). */
  readonly nothing = computed(() => !this.progress().collections && !this.progress().total);
  readonly progress = computed(() => this.overview()?.progress ?? { total: 0, left: 0, collections: 0, done: 0 });

  /** Collections opened to show their summaries. */
  readonly expanded = signal(new Set<string>());
  /** Summaries of each opened collection. */
  readonly items = signal(new Map<string, ILegacyItem[]>());
  /** Per-collection name filter. */
  readonly filters = signal(new Map<string, string>());
  /** Picked summaries: collection id → summary ids (several collections at once is fine). */
  readonly selected = signal(new Map<string, Set<string>>());
  readonly selectedCount = computed(() => [...this.selected().values()].reduce((n, s) => n + s.size, 0));
  /** Where "move" puts things (picked in the tree): a folder, or NO_FOLDER_TARGET. */
  readonly target = signal<string | null>(null);
  readonly targetFolder = computed(() => (this.target() ? this.store.byId().get(this.target()!) ?? null : null));
  readonly busy = signal(false);
  readonly drag = signal<Drag | null>(null);
  readonly landed = signal<string | null>(null);
  private landTimer?: ReturnType<typeof setTimeout>;

  /** "Moved x to y" with its undo (or "undone"). */
  readonly toast = signal<UndoToast | null>(null);

  readonly FILTER_FROM = FILTER_FROM;

  // ---- search (the home page's box: operators, @user, :field:value, #capsule, saved searches) ----
  /** The applied search (its filters only), or {} for none. */
  readonly search = signal<ISummarySearch>({});
  /** Matching summaries per collection; null while no search is applied. */
  readonly matches = signal<Map<string, Set<string>> | null>(null);
  readonly searching = signal(false);
  /** The server returned only the first of more matches. */
  readonly capped = signal(false);
  private searchSeq = 0;
  /** During a search: only the collections with a match. */
  readonly shownCollections = computed(() => {
    const m = this.matches();
    return m ? this.collections().filter((c) => m.has(c.folder._id)) : this.collections();
  });
  readonly matchCount = computed(() => [...(this.matches()?.values() ?? [])].reduce((n, s) => n + s.size, 0));
  /** The matches that still wait to be moved (loaded and not already in a new folder): what "pick all results" picks. */
  readonly pendingMatches = computed(() => {
    const m = this.matches();
    if (!m) return new Map<string, string[]>();
    const out = new Map<string, string[]>();
    for (const [cid, ids] of m) {
      const pending = (this.items().get(cid) ?? []).filter((i) => ids.has(i._id) && !i.alsoIn.length).map((i) => i._id);
      if (pending.length) out.set(cid, pending);
    }
    return out;
  });
  readonly pendingMatchCount = computed(() => [...this.pendingMatches().values()].reduce((n, l) => n + l.length, 0));
  /** Matches already in a new folder. */
  readonly movedMatchCount = computed(() => {
    const m = this.matches();
    if (!m) return 0;
    let n = 0;
    for (const [cid, ids] of m) n += (this.items().get(cid) ?? []).filter((i) => ids.has(i._id) && i.alsoIn.length).length;
    return n;
  });

  constructor() {
    this.load();
    // The tree (or another tab's change through it) changed the folders: counts may have changed too.
    this.folders.changed$.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(() => this.load());
  }

  // ---- data ----
  private load() {
    this.legacy.overview().subscribe((o) => {
      this.overview.set(o);
      const ids = new Set(o.collections.map((c) => c.folder._id));
      // Forget collections that left (moved out or deleted by someone).
      this.selected.update((m) => new Map([...m].filter(([id]) => ids.has(id))));
      this.expanded.update((s) => new Set([...s].filter((id) => ids.has(id))));
      // The first time, open the first collection that still has something to sort.
      if (!this.loadedOnce) {
        this.loadedOnce = true;
        const first = o.collections.find((c) => c.left > c.folder.hiddenCount);
        if (first) this.toggle(first.folder._id);
      }
      for (const id of this.expanded()) this.loadItems(id);
      // What matches may have changed too (summaries left their collections).
      if (this.matches()) this.runSearch();
    });
  }

  /** The search box applied a search (or cleared it). */
  onSearch(raw: ISummarySearch) {
    // Only what selects summaries; the server scopes it to the collections.
    const { folders: _, ...s } = alertSearch(raw);
    this.search.set(s);
    this.runSearch();
  }

  clearSearch() {
    this.search.set({});
    this.runSearch();
  }

  private runSearch() {
    const seq = ++this.searchSeq;
    const s = this.search();
    if (!Object.keys(s).length) {
      this.searching.set(false);
      this.matches.set(null);
      this.capped.set(false);
      return;
    }
    this.searching.set(true);
    this.legacy.search(s).subscribe({
      next: (r) => {
        if (seq !== this.searchSeq) return;
        this.searching.set(false);
        this.capped.set(r.capped);
        const m = new Map(Object.entries(r.matches).map(([cid, ids]) => [cid, new Set(ids)]));
        this.matches.set(m);
        // Open every collection with a match, so the results show.
        const closed = [...m.keys()].filter((id) => !this.expanded().has(id));
        if (closed.length) this.expanded.update((s) => new Set([...s, ...closed]));
        for (const id of closed) this.loadItems(id);
      },
      error: () => {
        if (seq === this.searchSeq) this.searching.set(false);
      },
    });
  }

  /** Pick every result that still waits to be moved (replacing the picks). */
  pickMatches() {
    this.selected.set(new Map([...this.pendingMatches()].map(([cid, ids]) => [cid, new Set(ids)])));
  }

  /** How many of the collection's summaries match the search. */
  matchesIn(id: string): number {
    return this.matches()?.get(id)?.size ?? 0;
  }
  private loadedOnce = false;

  private loadItems(id: string) {
    this.legacy.items(id).subscribe((list) => {
      this.items.update((m) => new Map(m).set(id, list));
      // Drop picks of summaries that are no longer in it.
      const still = new Set(list.map((i) => i._id));
      const picked = this.selected().get(id);
      if (picked && [...picked].some((s) => !still.has(s))) this.setPicked(id, [...picked].filter((s) => still.has(s)));
    });
  }

  toggle(id: string) {
    const open = this.expanded().has(id);
    this.expanded.update((s) => {
      const next = new Set(s);
      if (open) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!open) this.loadItems(id);
  }

  // ---- display helpers ----
  /** The section of the user's own summaries that were in no collection (the legacy root itself). */
  isUnfiled(id: string): boolean {
    return id === this.overview()?.rootId;
  }

  /** A collection someone else manages: only the user's own summaries in it show. */
  isAuthored(id: string): boolean {
    return this.authored().has(id);
  }

  /** Only the user's own summaries, sorted one by one: no actions on the collection as a whole. */
  isOwnOnly(id: string): boolean {
    return this.isUnfiled(id) || this.isAuthored(id);
  }

  /** The user's own summaries already sorted out of a collection of others, and where they are now. */
  sortedOut(id: string): ILegacySorted[] {
    return this.authored().get(id)?.sorted ?? [];
  }

  /** Who manages a collection of others, for its header. */
  managersOf(id: string): string {
    return (this.authored().get(id)?.managers ?? []).map((m) => m.fullName || m.username).join(', ');
  }

  sortedOf(c: ILegacyCollection): number {
    return Math.max(0, c.total - c.left);
  }

  collectionPercent(c: ILegacyCollection): number {
    return c.total ? Math.round((this.sortedOf(c) / c.total) * 100) : 100;
  }

  /** The summary's own full page, which its link opens in a new tab. */
  readonly pageLink = summaryPageLink;

  itemIcon(item: ILegacyItem): string {
    if (item.alsoIn.length) return 'check-circle';
    return item.kind === SummaryKind.Running ? 'unordered-list' : 'file-text';
  }

  filterOf(id: string): string {
    return this.filters().get(id) ?? '';
  }

  setFilter(id: string, value: string) {
    this.filters.update((m) => new Map(m).set(id, value));
  }

  /** The collection's summaries that pass its filter and the search: the ones waiting first, then those already moved. */
  shown(id: string): ILegacyItem[] {
    const term = this.filterOf(id).trim().toLowerCase();
    const matched = this.matches()?.get(id);
    const list = (this.items().get(id) ?? []).filter((i) => (!term || i.name.toLowerCase().includes(term)) && (!matched || matched.has(i._id)));
    return [...list.filter((i) => !i.alsoIn.length), ...list.filter((i) => i.alsoIn.length)];
  }

  /** Of the shown summaries, the ones still waiting to be moved. */
  shownPending(id: string): ILegacyItem[] {
    return this.shown(id).filter((i) => !i.alsoIn.length);
  }

  /** Of the shown summaries, the ones already in a new folder. */
  shownMoved(id: string): ILegacyItem[] {
    return this.shown(id).filter((i) => i.alsoIn.length);
  }

  /** Summaries in the collection that are already in a folder outside the legacy root. */
  alreadySorted(id: string): ILegacyItem[] {
    return (this.items().get(id) ?? []).filter((i) => i.alsoIn.length);
  }

  /** Names joined for a hint line. */
  names(list: { name: string }[]): string {
    return list.map((f) => f.name).join(', ');
  }

  /** Permissions needed to see the folder in the tree: its own and every ancestor's. */
  private chainPermissions(id: string | null): IPermission[] {
    const f = id ? this.store.byId().get(id) : undefined;
    if (!f) return [];
    const all = new Map<string, IPermission>();
    for (const x of [...this.store.ancestors(id), f]) for (const p of x.permissions) all.set(p._id, p);
    return [...all.values()];
  }

  // ---- selection ----
  isPicked(collectionId: string, itemId: string): boolean {
    return !!this.selected().get(collectionId)?.has(itemId);
  }

  private setPicked(collectionId: string, ids: string[]) {
    this.selected.update((m) => {
      const next = new Map(m);
      if (ids.length) next.set(collectionId, new Set(ids));
      else next.delete(collectionId);
      return next;
    });
  }

  pick(collectionId: string, itemId: string, on: boolean) {
    const cur = new Set(this.selected().get(collectionId));
    if (on) cur.add(itemId);
    else cur.delete(itemId);
    this.setPicked(collectionId, [...cur]);
  }

  /** The header checkbox: all shown (after the filter), or none. */
  allPicked(id: string): boolean {
    const shown = this.shown(id);
    return shown.length > 0 && shown.every((i) => this.isPicked(id, i._id));
  }

  somePicked(id: string): boolean {
    return !this.allPicked(id) && this.shown(id).some((i) => this.isPicked(id, i._id));
  }

  pickAll(id: string, on: boolean) {
    const shown = this.shown(id).map((i) => i._id);
    const cur = new Set(this.selected().get(id));
    for (const s of shown) if (on) cur.add(s);
    else cur.delete(s);
    this.setPicked(id, [...cur]);
  }

  clearSelection() {
    this.selected.set(new Map());
  }

  private nameOfCollection(id: string): string {
    return this.collections().find((c) => c.folder._id === id)?.folder.name ?? '';
  }

  // ---- drag onto the tree ----
  onItemDragStart(e: DragEvent, collectionId: string, item: ILegacyItem) {
    // Dragging a row that isn't picked drags just that row.
    if (!this.isPicked(collectionId, item._id)) this.selected.set(new Map([[collectionId, new Set([item._id])]]));
    this.startDrag(e, { kind: 'items' }, this.selectedCount() > 1 ? `${this.selectedCount()} תמציות` : item.name);
  }

  onCollectionDragStart(e: DragEvent, collection: ILegacyCollection) {
    // The unfiled section isn't a folder, and a collection of others isn't the user's to move: neither goes as a whole.
    if (this.isOwnOnly(collection.folder._id)) return e.preventDefault();
    this.startDrag(e, { kind: 'collection', collection }, collection.folder.name);
  }

  private startDrag(e: DragEvent, drag: Drag, label: string) {
    e.dataTransfer?.setData('text/plain', label);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    this.drag.set(drag);
  }

  endDrag() {
    this.drag.set(null);
  }

  /** The small confirm on a tree row: move the picked summaries there (or out, "without folder"). */
  onChosen(folderId: string) {
    if (folderId === NO_FOLDER_TARGET) this.releaseSelected();
    else this.moveSelected(folderId);
  }

  onDropped(folderId: string) {
    const d = this.drag();
    this.drag.set(null);
    if (!d) return;
    if (d.kind === 'items' && folderId === NO_FOLDER_TARGET) this.releaseSelected();
    else if (d.kind === 'items') this.moveSelected(folderId);
    else this.moveCollection(d.collection, folderId);
  }

  // ---- actions on picked summaries ----
  /** Move every picked summary into the folder (default: the target; "without folder" just takes them out). */
  moveSelected(to = this.target()) {
    if (to === NO_FOLDER_TARGET) return this.releaseSelected();
    const folder = to ? this.store.byId().get(to) : null;
    const groups = [...this.selected()];
    if (!folder || !groups.length || this.busy()) return;
    // Summaries whose viewers don't all hold the folder's permissions: some who see them won't find them there.
    const chain = this.chainPermissions(folder._id);
    const picked = groups.flatMap(([cid, ids]) => (this.items().get(cid) ?? []).filter((i) => ids.has(i._id)));
    const narrower = picked.filter((i) => chain.some((p) => !i.permissions.some((q) => q._id === p._id)));
    const extra = [...new Map(narrower.flatMap((i) => chain.filter((p) => !i.permissions.some((q) => q._id === p._id))).map((p) => [p._id, p])).values()];
    const what = narrower.length === 1 ? `"${narrower[0].name}"` : `${narrower.length} מהתמציות`;
    this.confirmNarrower(folder.name, extra, `${what} בתיקייה`, `להעביר אל "${folder.name}"?`, () => this.doMoveSelected(folder, groups));
  }

  /**
   * Going into `folderName` hides `what` from people who lack `extra` (the folder chain's permissions the thing itself
   * doesn't require): say so before `go`. Nothing to say: just go.
   */
  private confirmNarrower(folderName: string, extra: IPermission[], what: string, title: string, go: () => void) {
    if (!extra.length) return go();
    this.modal.confirm({
      nzTitle: title,
      nzContent: `בתוך "${folderName}" רק מי שיש לו גם ${extra.map((p) => `"${p.name}"`).join(', ')} יראה את ${what}. התמציות עצמן לא משנות הרשאות, ועדיין יופיעו בחיפוש למי שרשאי לראות אותן.`,
      nzOkText: 'העברה',
      nzCancelText: 'ביטול',
      nzOnOk: go,
    });
  }

  private doMoveSelected(folder: IFolder, groups: [string, Set<string>][]) {
    if (this.busy()) return;
    this.busy.set(true);
    forkJoin(groups.map(([cid, ids]) => this.legacy.moveItems(cid, folder._id, [...ids]).pipe(map((r) => ({ cid, r }))))).subscribe({
      next: (results) => {
        this.busy.set(false);
        const moved = results.reduce((n, x) => n + x.r.applied.length, 0);
        const skipped = results.reduce((n, x) => n + x.r.skipped.length, 0);
        this.clearSelection();
        if (skipped) this.message.warning(`${skipped} תמציות לא הועברו (טיוטות או תמציות שלא נמצאו)`);
        if (!moved) return;
        this.land(folder._id);
        const added = [...new Set(results.flatMap((x) => x.r.added))];
        this.toastMoved(`${moved === 1 ? 'תמצית אחת הועברה' : `${moved} תמציות הועברו`} אל "${folder.name}"`, () =>
          forkJoin(results.filter((x) => x.r.applied.length).map((x) => this.legacy.restoreItems(x.cid, x.r.applied))).pipe(
            switchMap(() => (added.length ? this.folders.removeItems(folder._id, added) : of(null))),
          ),
        );
        this.offerDelete(results.filter((x) => x.r.applied.length && x.r.left === 0).map((x) => x.cid));
      },
      error: () => this.busy.set(false),
    });
  }

  /**
   * Take the summaries out of their collection without putting them anywhere: they are already in a folder, or need
   * none (then they show under "summaries in no folder").
   */
  release(groups: [string, string[]][], what: string) {
    groups = groups.filter(([, ids]) => ids.length);
    if (!groups.length || this.busy()) return;
    this.busy.set(true);
    forkJoin(groups.map(([cid, ids]) => this.legacy.releaseItems(cid, ids).pipe(map((r) => ({ cid, r }))))).subscribe({
      next: (results) => {
        this.busy.set(false);
        this.clearSelection();
        const n = results.reduce((s, x) => s + x.r.applied.length, 0);
        if (!n) return;
        this.toastMoved(`${n === 1 ? 'תמצית אחת הוצאה' : `${n} תמציות הוצאו`} ${what}`, () =>
          forkJoin(results.map((x) => this.legacy.restoreItems(x.cid, x.r.applied))),
        );
        this.offerDelete(results.filter((x) => x.r.applied.length && x.r.left === 0).map((x) => x.cid));
      },
      error: () => this.busy.set(false),
    });
  }

  releaseSelected() {
    this.release(
      [...this.selected()].map(([cid, ids]) => [cid, [...ids]]),
      'מהלקט',
    );
  }

  /** "Done here" on one summary that is already in a folder. */
  releaseOne(collectionId: string, item: ILegacyItem) {
    this.release([[collectionId, [item._id]]], 'מהלקט');
  }

  /** Take out the collection's summaries that are already in a folder (default: all of them; or just the shown ones). */
  releaseSorted(c: ILegacyCollection, list = this.alreadySorted(c.folder._id)) {
    this.release([[c.folder._id, list.map((i) => i._id)]], `מ"${c.folder.name}" (כבר בתיקיות)`);
  }

  // ---- actions on a whole collection ----
  /** "Keep as is": the collection becomes an ordinary top-level folder, with everything in it. */
  keepAsIs(c: ILegacyCollection) {
    if (this.busy()) return;
    // The user's own ones stay as they are: out of the old Summer, into "summaries in no folder" (or the folders they're
    // already in). The collection itself is its managers' to keep.
    if (this.isOwnOnly(c.folder._id)) return this.withItems(c, (list) => this.release([[c.folder._id, list.map((i) => i._id)]], 'ונשארו כמו שהן'));
    this.busy.set(true);
    this.folders.move(c.folder._id, null).subscribe({
      next: () => {
        this.busy.set(false);
        this.toastMoved(`"${c.folder.name}" נשאר כמו שהוא, כתיקייה ברמה העליונה`, () => this.legacy.restoreCollection(c.folder._id));
      },
      error: () => this.busy.set(false),
    });
  }

  /**
   * The collection goes into the folder as a subfolder, with everything in it. Under a folder with permissions of its
   * own, people without them stop seeing it in the tree: say so first.
   */
  moveCollection(c: ILegacyCollection, to = this.target()) {
    const folder = to ? this.store.byId().get(to) : null;
    if (!folder || this.busy()) return;
    const own = new Set(c.folder.permissions.map((p) => p._id));
    const extra = this.chainPermissions(folder._id).filter((p) => !own.has(p._id));
    const go = () => {
      this.busy.set(true);
      this.folders.move(c.folder._id, folder._id).subscribe({
        next: () => {
          this.busy.set(false);
          this.land(folder._id);
          this.toastMoved(`"${c.folder.name}" הועבר כתיקיית משנה אל "${folder.name}"`, () => this.legacy.restoreCollection(c.folder._id));
        },
        error: () => this.busy.set(false),
      });
    };
    this.confirmNarrower(folder.name, extra, 'הלקט בעץ', `להעביר את "${c.folder.name}" אל "${folder.name}"?`, go);
  }

  /** Move the collection's summaries (the ones you can see) into the folder, leaving the collection empty. */
  mergeCollection(c: ILegacyCollection, to = this.target()) {
    if (!to) return;
    this.withItems(c, (list) => {
      if (!list.length) return;
      this.selected.set(new Map([[c.folder._id, new Set(list.map((i) => i._id))]]));
      this.moveSelected(to);
    });
  }

  /** Pick all of the collection's summaries (opening it). */
  pickCollection(c: ILegacyCollection) {
    const id = c.folder._id;
    if (!this.expanded().has(id)) this.toggle(id);
    this.withItems(c, (list) => this.setPicked(id, list.map((i) => i._id)));
  }

  /** Run `fn` with the collection's summaries, loading them first if they aren't yet. */
  private withItems(c: ILegacyCollection, fn: (list: ILegacyItem[]) => void) {
    const id = c.folder._id;
    const list = this.items().get(id);
    if (list) return fn(list);
    this.legacy.items(id).subscribe((loaded) => {
      this.items.update((m) => new Map(m).set(id, loaded));
      fn(loaded);
    });
  }

  deleteCollection(c: ILegacyCollection) {
    this.modal.confirm({
      nzTitle: `למחוק את הלקט "${c.folder.name}"?`,
      nzContent: c.left ? `נשארו בו ${c.left} תמציות. הן לא יימחקו, רק יצאו מהלקט.` : 'הלקט ריק. התמציות שהיו בו כבר בתיקיות החדשות.',
      nzOkText: 'מחיקה',
      nzOkDanger: true,
      nzCancelText: 'ביטול',
      nzOnOk: () => this.deleteNow([c.folder._id]),
    });
  }

  /** After a move emptied collections: congratulate, and offer to delete them. */
  private offerDelete(ids: string[]) {
    // The unfiled section is the legacy root itself, and a collection of others isn't the user's to delete (it may well
    // still hold other people's summaries): both just leave this page once the user's own are sorted.
    ids = ids.filter((id) => !this.isOwnOnly(id));
    if (!ids.length) return;
    const names = ids.map((id) => `"${this.nameOfCollection(id)}"`).join(', ');
    this.modal.confirm({
      nzTitle: ids.length === 1 ? `סיימתם למיין את ${names} 🎉` : `סיימתם למיין ${ids.length} לקטים 🎉`,
      nzContent: `${ids.length === 1 ? 'הלקט ריק עכשיו' : `${names} ריקים עכשיו`}. למחוק ${ids.length === 1 ? 'אותו' : 'אותם'}? (התמציות לא יימחקו.)`,
      nzOkText: 'מחיקה',
      nzCancelText: 'לא עכשיו',
      nzOnOk: () => this.deleteNow(ids),
    });
  }

  /** DEV ONLY (for demos): everything back in the legacy root, as at sunrise. */
  resetDemo() {
    this.modal.confirm({
      nzTitle: 'לאפס את הדמו?',
      nzContent: 'כל הלקטים והתמציות לדוגמה יחזרו להתחלה, וכל מה שמוין מהם יתבטל. שאר התיקיות והתמציות לא ישתנו.',
      nzOkText: 'איפוס',
      nzOkDanger: true,
      nzCancelText: 'ביטול',
      nzOnOk: () =>
        new Promise<void>((resolve, reject) => {
          this.dropToast();
          this.clearSelection();
          this.target.set(null);
          this.items.set(new Map());
          this.expanded.set(new Set());
          this.loadedOnce = false;
          this.legacy.demoReset().subscribe({
            next: () => {
              this.message.success('הדמו אופס. בוקר טוב! 🌅');
              resolve();
            },
            error: reject,
          });
        }),
    });
  }

  private deleteNow(ids: string[]): Promise<void> {
    // Deleting ends what the undo could restore.
    this.dropToast();
    return new Promise((resolve, reject) =>
      forkJoin(ids.map((id) => this.folders.delete(id))).subscribe({
        next: () => {
          this.message.success(ids.length === 1 ? 'הלקט נמחק' : 'הלקטים נמחקו');
          resolve();
        },
        error: reject,
      }),
    );
  }

  // ---- feedback ----
  private land(id: string) {
    clearTimeout(this.landTimer);
    this.landed.set(id);
    this.landTimer = setTimeout(() => this.landed.set(null), LANDED_MS);
  }

  /** "Moved x to y" with an undo button, for UNDO_MS. */
  private toastMoved(text: string, undo: () => Observable<unknown>) {
    this.toast.set({ text, undo, ms: UNDO_MS });
  }

  private dropToast() {
    this.toast.set(null);
  }

  undo() {
    const undo = this.toast()?.undo;
    if (!undo) return;
    this.toast.set(null);
    undo().subscribe(() => this.toast.set({ text: 'הפעולה בוטלה', ms: UNDONE_MS }));
  }
}
