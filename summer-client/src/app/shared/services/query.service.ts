import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';
import { alertSearch, sameAlertSearch } from '../../features/summaries/search-query';
import { IQuery, ISummarySearch, QueryAlertSettings, QueryKind } from '../models';
import { stripPaging } from './search-history.service';

const BASE = '/api/queries';

/** Lowercased, no niqqud-free tricks: just enough for "does the name contain what was typed". */
const norm = (s: string) => s.trim().toLowerCase();

/** The user's own queries first (favourites first), then the shared ones they follow. */
const order = (list: IQuery[]) => [...list.filter((q) => q.isMine && q.isFavorite), ...list.filter((q) => q.isMine && !q.isFavorite), ...list.filter((q) => !q.isMine)];

/**
 * The user's queries: every saved search of theirs, others' shared queries they alert on, and the alerts. One list for
 * the whole app (search box, advanced search, profile, notifications page); every change answers with the changed
 * query, which replaces the cached one. Others' shared queries are browsed with `shared()`, outside the cache.
 */
@Injectable({ providedIn: 'root' })
export class QueryService {
  private readonly http = inject(HttpClient);
  private readonly _list = signal<IQuery[] | null>(null);
  private loading = false;

  /** Null until loaded (call `ensureLoaded`). */
  readonly list = this._list.asReadonly();
  /** Own queries and followed shared ones. */
  readonly all = computed(() => this._list() ?? []);
  /** The user's saved searches (their own queries): favourites first, then newest first. */
  readonly queries = computed(() => this.all().filter((q) => q.isMine));
  /** Queries with the user's alert (active or paused), theirs or followed. */
  readonly alerting = computed(() => this.all().filter((q) => q.alert));

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
    return id ? this.all().find((q) => q._id === id) : undefined;
  }

  /** The user's query that finds what this search finds, if one is saved. */
  matching(search: ISummarySearch): IQuery | undefined {
    if (!Object.keys(alertSearch(search)).length) return undefined;
    return this.queries().find((q) => sameAlertSearch(q.search, search));
  }

  /** Queries whose name has `text` in it, in the list's own order, at most `limit`. */
  search(text: string, limit = 8, list = this.queries()): IQuery[] {
    const q = norm(text);
    return (q ? list.filter((x) => norm(x.name).includes(q)) : list).slice(0, limit);
  }

  /** Others' shared queries, newest first, a page (30) at a time; `text` narrows by name or owner. */
  shared(text = '', offset = 0): Observable<IQuery[]> {
    return this.http.get<IQuery[]>(`${BASE}/shared`, { params: { q: text.trim(), offset } });
  }

  create(name: string, kind: QueryKind, search: ISummarySearch, alert?: Partial<QueryAlertSettings>): Observable<IQuery> {
    return this.http.post<IQuery>(BASE, { name, kind, search: stripPaging(search), ...(alert ? { alert } : {}) }).pipe(tap((q) => this.put(q, true)));
  }

  /** The user's own copy of a query (private, no alert); it no longer follows the original. */
  copy(id: string, name?: string): Observable<IQuery> {
    return this.http.post<IQuery>(`${BASE}/${id}/copy`, name ? { name } : {}).pipe(tap((q) => this.put(q, true)));
  }

  update(id: string, patch: { name?: string; kind?: QueryKind; search?: ISummarySearch; isFavorite?: boolean; isShared?: boolean }): Observable<IQuery> {
    const body = patch.search ? { ...patch, search: stripPaging(patch.search) } : patch;
    return this.http.put<IQuery>(`${BASE}/${id}`, body).pipe(tap((q) => this.put(q)));
  }

  remove(id: string): Observable<void> {
    return this.http.delete(`${BASE}/${id}`).pipe(
      tap(() => this._list.update((l) => l?.filter((q) => q._id !== id) ?? l)),
      map(() => undefined),
    );
  }

  /** Turn the user's alert on (active unless said otherwise) or change how it notifies; on a shared query, this follows it. */
  setAlert(id: string, settings: Partial<QueryAlertSettings> = {}): Observable<IQuery> {
    return this.http.put<IQuery>(`${BASE}/${id}/alert`, settings).pipe(tap((q) => this.put(q)));
  }

  /** Stop alerting; on someone else's query, this unfollows it. */
  removeAlert(id: string): Observable<IQuery> {
    return this.http.delete<IQuery>(`${BASE}/${id}/alert`).pipe(tap((q) => this.put(q)));
  }

  /** Replace (or add) a query in the cache; someone else's query stays only while the user alerts on it. */
  private put(q: IQuery, isNew = false): void {
    this._list.update((list) => {
      if (!list) return list;
      const rest = list.filter((x) => x._id !== q._id);
      if (!q.isMine && !q.alert) return rest;
      const next = isNew ? [q, ...rest] : list.some((x) => x._id === q._id) ? list.map((x) => (x._id === q._id ? q : x)) : [q, ...rest];
      return order(next);
    });
  }
}
