import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';
import { IUserGroup, UserGroupPayload } from '../models';

const BASE = '/api/user-groups';

const norm = (s: string) => s.trim().toLowerCase();

/** Favourites first, then by name. */
const order = (list: IUserGroup[]) => [...list].sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite) || a.name.localeCompare(b.name, 'he'));

/**
 * The user's own user groups, cached for the whole app (profile, tag fields). Every change answers with the changed
 * group, which replaces the cached one. Others' shared groups are browsed with `shared()`, outside the cache.
 */
@Injectable({ providedIn: 'root' })
export class UserGroupService {
  private readonly http = inject(HttpClient);
  private readonly _list = signal<IUserGroup[] | null>(null);
  private loading = false;

  /** Null until loaded (call `ensureLoaded`). */
  readonly list = this._list.asReadonly();

  ensureLoaded(): void {
    if (this._list() !== null || this.loading) return;
    this.loading = true;
    this.http.get<IUserGroup[]>(BASE).subscribe({
      next: (list) => {
        this._list.set(list);
        this.loading = false;
      },
      error: () => (this.loading = false),
    });
  }

  /** The user's groups whose name has `text` in it, in the list's own order. */
  search(text: string): IUserGroup[] {
    const q = norm(text);
    const list = this._list() ?? [];
    return q ? list.filter((g) => norm(g.name).includes(q)) : list;
  }

  /** Others' shared groups, newest change first, a page (30) at a time; `text` narrows by name or owner. */
  shared(text = '', offset = 0): Observable<IUserGroup[]> {
    return this.http.get<IUserGroup[]>(`${BASE}/shared`, { params: { q: text.trim(), offset } });
  }

  create(group: UserGroupPayload): Observable<IUserGroup> {
    return this.http.post<IUserGroup>(BASE, group).pipe(tap((g) => this.put(g)));
  }

  /** The user's own private copy of a group (theirs or a shared one). */
  copy(id: string, name?: string): Observable<IUserGroup> {
    return this.http.post<IUserGroup>(`${BASE}/${id}/copy`, name ? { name } : {}).pipe(tap((g) => this.put(g)));
  }

  update(id: string, patch: Partial<UserGroupPayload>): Observable<IUserGroup> {
    return this.http.put<IUserGroup>(`${BASE}/${id}`, patch).pipe(tap((g) => this.put(g)));
  }

  remove(id: string): Observable<void> {
    return this.http.delete(`${BASE}/${id}`).pipe(
      tap(() => this._list.update((l) => l?.filter((g) => g._id !== id) ?? l)),
      map(() => undefined),
    );
  }

  private put(g: IUserGroup): void {
    this._list.update((list) => (list ? order([g, ...list.filter((x) => x._id !== g._id)]) : list));
  }
}
