import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { IPermission } from '../models';

/** Permission groups: the catalog and the ones the current user holds. */
@Injectable({ providedIn: 'root' })
export class PermissionService {
  private readonly http = inject(HttpClient);

  private readonly _list = signal<IPermission[]>([]);
  readonly list = this._list.asReadonly();
  private readonly _loaded = signal(false);
  /** The catalog has arrived (false until the first fetch answers). */
  readonly loaded = this._loaded.asReadonly();
  readonly byId = computed(() => new Map(this._list().map((p) => [p._id, p])));

  // Viewing requires every assigned group, so the server only lets you assign groups you belong to.
  private readonly _mine = signal<ReadonlySet<string>>(new Set());
  /** Groups the current user may assign to summaries and folders. */
  readonly assignable = computed(() => this._list().filter((p) => this._mine().has(p._id)));

  constructor() {
    this.reload();
  }

  reload(): void {
    this.http.get<IPermission[]>('/api/permissions').subscribe({
      next: (list) => {
        this._list.set(list);
        this._loaded.set(true);
      },
      error: () => this._loaded.set(true),
    });
    this.http.get<IPermission[]>('/api/permissions/user').subscribe((mine) => this._mine.set(new Set(mine.map((p) => p._id))));
  }
}
