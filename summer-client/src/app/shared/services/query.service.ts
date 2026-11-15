import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';
import { alertSearch, sameAlertSearch } from '../../features/summaries/search-query';
import { IQuery, ISummarySearch, QueryAlertSettings, QueryKind } from '../models';
import { stripPaging } from './search-history.service';

const BASE = '/api/queries';

/** Lowercased, no niqqud-free tricks: just enough for "does the name contain what was typed". */
const norm = (s: string) => s.trim().toLowerCase();

/**
 * The user's queries: every saved search, and the alerts on them. One list for the whole app (search box, advanced
 * search, profile, notifications page); every change answers with the changed query, which replaces the cached one.
 */
@Injectable({ providedIn: 'root' })
export class QueryService {
  private readonly http = inject(HttpClient);
  private readonly _list = signal<IQuery[] | null>(null);
  private loading = false;

  /** Null until loaded (call `ensureLoaded`). Favourites first, then newest first. */
  readonly list = this._list.asReadonly();
  readonly queries = computed(() => this._list() ?? []);
  /** Queries with an alert (active or paused). */
  readonly alerting = computed(() => this.queries().filter((q) => q.alert));

  ensureLoaded(): void {
    if (this._list() !== null || this.loading) return;
    this.reload();
  }

  reload(): void {
    this.loading = true;
    this.http.get<IQuery[]>(BASE).subscribe({
      next: (list) => {
        this._list.set(list);
        this.loading = false;
      },
      error: () => (this.loading = false),
    });
  }

  byId(id: string | null | undefined): IQuery | undefined {
    return id ? this.queries().find((q) => q._id === id) : undefined;
  }

  /** The query that finds what this search finds, if one is saved. */
  matching(search: ISummarySearch): IQuery | undefined {
    if (!Object.keys(alertSearch(search)).length) return undefined;
    return this.queries().find((q) => sameAlertSearch(q.search, search));
  }

  /** Queries whose name has `text` in it, favourites first (the list's own order), at most `limit`. */
  search(text: string, limit = 8, list = this.queries()): IQuery[] {
    const q = norm(text);
    return (q ? list.filter((x) => norm(x.name).includes(q)) : list).slice(0, limit);
  }

  create(name: string, kind: QueryKind, search: ISummarySearch, alert?: Partial<QueryAlertSettings>): Observable<IQuery> {
    return this.http.post<IQuery>(BASE, { name, kind, search: stripPaging(search), ...(alert ? { alert } : {}) }).pipe(tap((q) => this.put(q, true)));
  }

  update(id: string, patch: { name?: string; kind?: QueryKind; search?: ISummarySearch; isFavorite?: boolean }): Observable<IQuery> {
    const body = patch.search ? { ...patch, search: stripPaging(patch.search) } : patch;
    return this.http.put<IQuery>(`${BASE}/${id}`, body).pipe(tap((q) => this.put(q)));
  }

  remove(id: string): Observable<void> {
    return this.http.delete(`${BASE}/${id}`).pipe(
      tap(() => this._list.update((l) => l?.filter((q) => q._id !== id) ?? l)),
      map(() => undefined),
    );
  }

  /** Turn the query's alert on (active unless said otherwise) or change how it notifies. */
  setAlert(id: string, settings: Partial<QueryAlertSettings> = {}): Observable<IQuery> {
    return this.http.put<IQuery>(`${BASE}/${id}/alert`, settings).pipe(tap((q) => this.put(q)));
  }

  removeAlert(id: string): Observable<IQuery> {
    return this.http.delete<IQuery>(`${BASE}/${id}/alert`).pipe(tap((q) => this.put(q)));
  }

  /** Replace (or add) a query in the cache, keeping favourites first. */
  private put(q: IQuery, isNew = false): void {
    this._list.update((list) => {
      if (!list) return list;
      const rest = list.filter((x) => x._id !== q._id);
      const next = isNew ? [q, ...rest] : list.some((x) => x._id === q._id) ? list.map((x) => (x._id === q._id ? q : x)) : [q, ...rest];
      return [...next.filter((x) => x.isFavorite), ...next.filter((x) => !x.isFavorite)];
    });
  }
}
