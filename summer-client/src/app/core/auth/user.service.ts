import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, of, shareReplay, tap } from 'rxjs';
import { ISummarySearch, IUser, UserRef } from '../../shared/models';
import { SILENT_ERRORS } from '../http/http-context';

const BASE = '/api/user';

/** Logged-in user state. Every pin/favorite/follow call returns the updated IUser, which replaces the cached one. */
@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly http = inject(HttpClient);
  private readonly _user = signal<IUser | null>(null);
  private loading$: Observable<IUser> | null = null;

  readonly user = this._user.asReadonly();
  readonly userId = computed(() => this._user()?._id ?? null);

  load(): Observable<IUser> {
    this.loading$ = this.http.get<IUser>(BASE, { context: new HttpContext().set(SILENT_ERRORS, true) }).pipe(
      tap((u) => this._user.set(u)),
      shareReplay(1),
    );
    return this.loading$;
  }

  /** Resolve the current user once per session (used by the shell guard). */
  ensureLoaded(): Observable<IUser> {
    const user = this._user();
    if (user) return of(user);
    return this.loading$ ?? this.load();
  }

  clear(): void {
    this._user.set(null);
    this.loading$ = null;
  }

  // ---- lookups ----
  byUsername(username: string) {
    return this.http.get<UserRef>(`${BASE}/${encodeURIComponent(username)}`);
  }
  byIds(ids: string[]) {
    return this.http.get<UserRef[]>(`${BASE}/ids`, { params: { _ids: ids.join(',') } });
  }
  query(prefix: string) {
    return this.http.get<UserRef[]>(`${BASE}/query/${encodeURIComponent(prefix)}`);
  }
  byName(text: string) {
    return this.http.get<UserRef[]>(`${BASE}/name/${encodeURIComponent(text)}`);
  }

  // ---- pins / favorites / follows (all return the updated IUser) ----
  pinSearch(search: ISummarySearch, isPin: boolean) {
    return this.update(this.http.post<IUser>(`${BASE}/pinned-search/`, { ...search, isPin }));
  }
  pinLabel(label: string) {
    return this.update(this.http.post<IUser>(`${BASE}/pinned-label/`, { label }));
  }
  pinPermission(permissionId: string) {
    return this.update(this.http.post<IUser>(`${BASE}/pinned-permission/`, { permissionId }));
  }
  pinCollection(collectionId: string) {
    return this.update(this.http.post<IUser>(`${BASE}/pinned-collection/`, { collectionId }));
  }
  favoriteEntity(type: 'label' | 'collection' | 'permission', valueId: string) {
    return this.update(this.http.post<IUser>(`${BASE}/favorite-${type}/`, { valueId }));
  }
  favoriteSummary(summaryId: string) {
    return this.update(this.http.put<IUser>(`${BASE}/favorite`, { summaryId }));
  }
  follow(userId: string) {
    return this.update(this.http.put<IUser>(`${BASE}/add-follow/${userId}`, {}));
  }
  unfollow(userId: string) {
    return this.update(this.http.delete<IUser>(`${BASE}/remove-follow/${userId}`));
  }

  private update(req: Observable<IUser>) {
    return req.pipe(tap((u) => this._user.set(u)));
  }
}
