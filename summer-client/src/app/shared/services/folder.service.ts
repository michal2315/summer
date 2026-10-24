import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, Subject, tap } from 'rxjs';
import { FolderItemType, FolderPayload, IFolder, IFolderItem } from '../models';

const BASE = '/api/folder';

type ItemRef = Pick<IFolderItem, 'type' | '_id'>;

@Injectable({ providedIn: 'root' })
export class FolderService {
  private readonly http = inject(HttpClient);

  /** Emits after any mutation so the tree and the open folder refresh. */
  readonly changed$ = new Subject<void>();

  /** Every folder the user may see, flat — the client builds the tree from parentId. */
  tree(): Observable<IFolder[]> {
    return this.http.get<IFolder[]>(BASE);
  }

  items(folderId: string): Observable<IFolderItem[]> {
    return this.http.get<IFolderItem[]>(`${BASE}/${folderId}/items`);
  }

  create(payload: FolderPayload): Observable<IFolder> {
    return this.http.post<IFolder>(`${BASE}/create`, payload).pipe(tap(() => this.changed$.next()));
  }

  edit(id: string, payload: FolderPayload): Observable<IFolder> {
    return this.http.post<IFolder>(`${BASE}/edit/${id}`, payload).pipe(tap(() => this.changed$.next()));
  }

  /** Deletes the folder and its subfolders. Items inside are not deleted, only taken out of the hierarchy. */
  delete(id: string): Observable<unknown> {
    return this.http.delete(`${BASE}/${id}`).pipe(tap(() => this.changed$.next()));
  }

  /** Moves the items into the folder (out of whatever folder held them before). */
  addItems(folderId: string, items: ItemRef[]): Observable<unknown> {
    return this.http.post(`${BASE}/${folderId}/items`, { items }).pipe(tap(() => this.changed$.next()));
  }

  removeItems(folderId: string, items: ItemRef[]): Observable<unknown> {
    return this.http.post(`${BASE}/${folderId}/items/remove`, { items }).pipe(tap(() => this.changed$.next()));
  }
}

export const itemLink = (type: FolderItemType, id: string) => (type === 'collection' ? ['/collections', id] : ['/summaries', id]);
