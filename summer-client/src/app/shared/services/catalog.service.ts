import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Observable, forkJoin, map, of, shareReplay, tap } from 'rxjs';
import { ICollectionRef, IContentType, IField, IPermission, ISummary } from '../models';

/** Read-mostly catalogs: content types, custom fields, labels, permission groups, collections lookup. */
@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly http = inject(HttpClient);

  readonly contentTypes$ = this.http.get<IContentType[]>('/api/content-type').pipe(shareReplay(1));
  readonly fields$ = this.http.get<IField[]>('/api/field').pipe(shareReplay(1));

  readonly contentTypes = toSignal(this.contentTypes$, { initialValue: [] as IContentType[] });
  readonly fields = toSignal(this.fields$, { initialValue: [] as IField[] });
  readonly fieldsById = computed(() => new Map(this.fields().map((f) => [f._id, f])));

  // Permission groups are edited in the admin page, so this catalog is reloadable rather than cached forever.
  private readonly _permissions = signal<IPermission[]>([]);
  readonly permissions = this._permissions.asReadonly();
  readonly permissionsById = computed(() => new Map(this._permissions().map((p) => [p._id, p])));

  constructor() {
    this.reloadPermissions();
  }

  reloadPermissions(): void {
    this.http.get<IPermission[]>('/api/permissions').subscribe((list) => this._permissions.set(list));
  }

  savePermission(p: Partial<IPermission>): Observable<IPermission> {
    return this.http.put<IPermission>('/api/permissions', p).pipe(tap(() => this.reloadPermissions()));
  }

  deletePermission(id: string): Observable<unknown> {
    return this.http.delete(`/api/permissions/${id}`).pipe(tap(() => this.reloadPermissions()));
  }

  /** May the current user create/edit permission groups. */
  canManagePermissions(): Observable<boolean> {
    return this.http.get<boolean>('/api/permissions/permitted');
  }

  /** Dashboard access = the user belongs to at least one of the dashboard-permitted groups. */
  dashboardAccess(): Observable<boolean> {
    return forkJoin([this.http.get<IPermission[]>('/api/permissions/user'), this.http.get<IPermission[]>('/api/permissions/dashboard')]).pipe(
      map(([mine, allowed]) => mine.some((p) => allowed.some((a) => a._id === p._id))),
    );
  }

  labels(text: string, skip = 0): Observable<string[]> {
    return this.http.get<string[]>('/api/labels', { params: { text, skip } });
  }

  summariesByField(fieldId: string, value: string): Observable<Pick<ISummary, '_id' | 'title'>[]> {
    return this.http.get<Pick<ISummary, '_id' | 'title'>[]>('/api/field/summaries', { params: { fieldId, value } });
  }

  collectionsByName(text: string): Observable<ICollectionRef[]> {
    return this.http.get<ICollectionRef[]>(`/api/collection/collectionName/${encodeURIComponent(text)}`);
  }

  collectionsByIds(ids: string[]): Observable<ICollectionRef[]> {
    if (!ids.length) return of([]);
    return this.http.get<ICollectionRef[]>('/api/collection/ids', { params: { _ids: ids.join(',') } });
  }
}
