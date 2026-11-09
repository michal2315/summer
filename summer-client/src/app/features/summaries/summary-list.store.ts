import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { APP_CONFIG } from '../../core/config/app-config';
import { ISummariesLength, ISummary, ISummarySearch, SummarySearch } from '../../shared/models';
import { SummaryService } from '../../shared/services/summary.service';

const EMPTY_LENGTHS: ISummariesLength = { summary: 0, draft: 0, tagged: 0, favorite: 0 };

export interface ListQuery {
  ownerId: string;
  search: ISummarySearch;
}

/**
 * State for one summaries list (feed, profile, running summary). Provided per page, not root.
 * Card list uses append paging (skip/limit); table view uses replace paging (pageIndex).
 * Mutations broadcast by SummaryService patch rows in place — no refetch.
 */
@Injectable()
export class SummaryListStore {
  private readonly service = inject(SummaryService);
  private readonly config = inject(APP_CONFIG);
  readonly limit = this.config.summariesLimit;
  /** Set by the browser: open a running summary through the `runningId` query param (home page) instead of its own page. */
  readonly runningInPlace = signal(false);
  readonly maxSelection = this.config.maxToExport;

  private query: ListQuery | null = null;
  private inflight?: Subscription;

  readonly summaries = signal<ISummary[]>([]);
  readonly lengths = signal<ISummariesLength>(EMPTY_LENGTHS);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly pageIndex = signal(1);
  /** Bumped on every new query (not on loadMore) — lets views reset per-result-set UI state. */
  readonly version = signal(0);
  private readonly tab = signal<SummarySearch>(SummarySearch.Summary);

  // ---- selection mode (export / bulk edits) ----
  readonly selectMode = signal(false);
  /** Selected id → its row as listed when selected (kept across pages, so bulk actions know kind and canEdit). */
  private readonly selection = signal<ReadonlyMap<string, ISummary | undefined>>(new Map());
  readonly selected = computed<ReadonlySet<string>>(() => new Set(this.selection().keys()));
  readonly selectedCount = computed(() => this.selection().size);
  readonly selectedRows = computed(() => [...this.selection()].map(([id, summary]) => ({ id, summary })));
  /** Selected rows the user may not edit (a row never listed counts as editable; the server re-checks anyway). */
  readonly selectedNotEditable = computed(() => this.selectedRows().filter((r) => r.summary?.canEdit === false).map((r) => r.id));
  /** How much of the loaded list is selected (drives the select-all checkbox). */
  readonly loadedSelection = computed<'none' | 'some' | 'all'>(() => {
    const rows = this.summaries();
    const n = rows.filter((s) => this.selection().has(s._id)).length;
    return !n ? 'none' : n === rows.length ? 'all' : 'some';
  });

  /** Total for the active bucket (drives "N תמציות", table pagination and end-of-list detection). */
  readonly total = computed(() => {
    const l = this.lengths();
    switch (this.tab()) {
      case SummarySearch.Draft:
        return l.draft;
      case SummarySearch.Tagged:
        return l.tagged;
      case SummarySearch.Favorite:
        return l.favorite;
      default:
        return l.summary;
    }
  });
  readonly hasMore = computed(() => this.summaries().length < this.total());

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.service.changed$.pipe(takeUntilDestroyed(destroyRef)).subscribe((s) => this.patch(s));
    this.service.removed$.pipe(takeUntilDestroyed(destroyRef)).subscribe((id) => {
      if (this.summaries().some((s) => s._id === id)) {
        this.summaries.update((list) => list.filter((s) => s._id !== id));
        this.lengths.update((l) => ({ ...l, summary: Math.max(0, l.summary - 1) }));
      }
    });
  }

  /** New query: reset and fetch the first page. */
  load(query: ListQuery) {
    this.query = query;
    this.tab.set(query.search.summarySearch ?? SummarySearch.Summary);
    this.pageIndex.set(1);
    this.version.update((v) => v + 1);
    this.fetch(0, 'replace');
  }

  /** Infinite scroll. */
  loadMore() {
    if (!this.query || this.loading() || !this.hasMore()) return;
    this.fetch(this.summaries().length, 'append');
  }

  /** Table pagination (1-based). */
  goToPage(pageIndex: number) {
    if (!this.query) return;
    this.pageIndex.set(pageIndex);
    this.fetch((pageIndex - 1) * this.limit, 'replace');
  }

  /** Same query again (e.g. after a bulk edit). */
  reload() {
    if (this.query) this.load(this.query);
  }

  // ---- selection ----
  setSelectMode(on: boolean) {
    this.selectMode.set(on);
    if (!on) this.selection.set(new Map());
  }

  toggleSelected(id: string) {
    const next = new Map(this.selection());
    if (next.has(id)) next.delete(id);
    else if (next.size < this.maxSelection) next.set(id, this.summaries().find((s) => s._id === id));
    this.selection.set(next);
  }

  /** Select all of `ids` (up to the export cap), or clear them if they are all selected already (a bundle row). */
  toggleSelectedMany(ids: string[]) {
    const all = ids.every((id) => this.selection().has(id));
    const next = new Map(this.selection());
    for (const id of ids) {
      if (all) next.delete(id);
      else if (next.size < this.maxSelection && !next.has(id)) next.set(id, this.summaries().find((s) => s._id === id));
    }
    this.selection.set(next);
  }

  /** Select every loaded row (up to the export cap), or clear if they are all selected already. */
  toggleSelectAllLoaded() {
    const rows = this.summaries();
    const all = rows.every((s) => this.selection().has(s._id));
    const next = new Map(this.selection());
    for (const s of rows) {
      if (all) next.delete(s._id);
      else if (next.size < this.maxSelection && !next.has(s._id)) next.set(s._id, s);
    }
    this.selection.set(next);
  }

  /** Drop `ids` from the selection (e.g. the rows a bulk edit would skip). */
  deselect(ids: string[]) {
    const next = new Map(this.selection());
    for (const id of ids) next.delete(id);
    this.selection.set(next);
  }

  /** The query currently listed — used by "export all results". */
  currentQuery(): ListQuery | null {
    return this.query;
  }

  private fetch(skip: number, mode: 'append' | 'replace') {
    const query = this.query!;
    this.inflight?.unsubscribe();
    this.loading.set(true);
    const search = { ...query.search, skip, limit: this.limit };
    this.inflight = this.service.search(query.ownerId, search).subscribe({
      next: ({ summaries, lengths }) => {
        this.summaries.update((cur) => (mode === 'append' ? [...cur, ...summaries] : summaries));
        this.lengths.set(lengths);
        this.loading.set(false);
        this.loaded.set(true);
      },
      error: () => {
        this.loading.set(false);
        this.loaded.set(true);
      },
    });
  }

  private patch(updated: ISummary) {
    this.summaries.update((list) => {
      const i = list.findIndex((s) => s._id === updated._id);
      if (i === -1) return list;
      const copy = list.slice();
      copy[i] = { ...list[i], ...updated };
      return copy;
    });
  }
}
