import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, forkJoin, map, tap } from 'rxjs';
import { IPermission } from '../models';

/** Permission groups: the catalog, the ones the current user holds, and the admin operations. */
@Injectable({ providedIn: 'root' })
export class PermissionService {
  private readonly http = inject(HttpClient);

  // Permission groups are edited in the admin page, so this list is reloadable rather than cached forever.
  private readonly _list = signal<IPermission[]>([]);
  readonly list = this._list.asReadonly();
  readonly byId = computed(() => new Map(this._list().map((p) => [p._id, p])));

  // Viewing requires every assigned group, so the server only lets you assign groups you belong to.
  private readonly _mine = signal<ReadonlySet<string>>(new Set());
  /** Groups the current user may assign to summaries, collections and folders. */
  readonly assignable = computed(() => this._list().filter((p) => this._mine().has(p._id)));

  constructor() {
    this.reload();
  }

  reload(): void {
    this.http.get<IPermission[]>('/api/permissions').subscribe((list) => this._list.set(list));
    this.http.get<IPermission[]>('/api/permissions/user').subscribe((mine) => this._mine.set(new Set(mine.map((p) => p._id))));
  }

  save(p: Partial<IPermission>): Observable<IPermission> {
    return this.http.put<IPermission>('/api/permissions', p).pipe(tap(() => this.reload()));
  }

  delete(id: string): Observable<unknown> {
    return this.http.delete(`/api/permissions/${id}`).pipe(tap(() => this.reload()));
  }

  /** May the current user create/edit permission groups. */
  canManage(): Observable<boolean> {
    return this.http.get<boolean>('/api/permissions/permitted');
  }

  /** Dashboard access = the user belongs to at least one of the dashboard-permitted groups. */
  dashboardAccess(): Observable<boolean> {
    return forkJoin([this.http.get<IPermission[]>('/api/permissions/user'), this.http.get<IPermission[]>('/api/permissions/dashboard')]).pipe(
      map(([mine, allowed]) => mine.some((p) => allowed.some((a) => a._id === p._id))),
    );
  }
}
