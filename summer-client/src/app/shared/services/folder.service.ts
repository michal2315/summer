import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, Subject, tap } from 'rxjs';
import { FolderPayload, IBulkResult, IFolder, IFolderItem, ISummary, SummaryKind } from '../models';

const BASE = '/api/folder';

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

  /** Deletes the folder and its subfolders. Summaries inside are not deleted, only taken out of the hierarchy. */
  delete(id: string): Observable<unknown> {
    return this.http.delete(`${BASE}/${id}`).pipe(tap(() => this.changed$.next()));
  }

  /** Moves the folder (with its subfolders) under `parentId`, or to the root with null. */
  move(id: string, parentId: string | null): Observable<unknown> {
    return this.http.post(`${BASE}/${id}/move`, { parentId }).pipe(tap(() => this.changed$.next()));
  }

  /**
   * Moves the summaries into the folder (out of whatever folder held them before). `partial`: move the placeable ones
   * and report the rest (drafts, sumaroons, not yours), instead of failing the whole request.
   */
  addItems(folderId: string, summaryIds: string[], partial = false): Observable<IBulkResult> {
    return this.http.post<IBulkResult>(`${BASE}/${folderId}/items`, { summaryIds, partial }).pipe(tap(() => this.changed$.next()));
  }

  removeItems(folderId: string, summaryIds: string[]): Observable<unknown> {
    return this.http.post(`${BASE}/${folderId}/items/remove`, { summaryIds }).pipe(tap(() => this.changed$.next()));
  }
}

/** Home page query params that open a summary (or running summary) inside its folder. */
export function hierarchyParams(s: Pick<ISummary, '_id' | 'kind' | 'folder'>) {
  return { folderId: s.folder?._id, [s.kind === SummaryKind.Running ? 'runningId' : 'summaryId']: s._id };
}

export interface FolderPath {
  _id: string;
  name: string;
  /** names from the root down, joined with › */
  path: string;
}

/** Every folder labelled with its full path, sorted by path. */
export function folderPaths(folders: IFolder[]): FolderPath[] {
  const byId = new Map(folders.map((f) => [f._id, f]));
  const path = (f: IFolder): string => {
    const names: string[] = [];
    for (let cur: IFolder | undefined = f; cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) names.unshift(cur.name);
    return names.join(' › ');
  };
  return folders.map((f) => ({ _id: f._id, name: f.name, path: path(f) })).sort((a, b) => a.path.localeCompare(b.path, 'he'));
}

/** Folders `userId` manages (only managers may add to a folder), labelled and sorted like folderPaths. */
export function managedFolderPaths(folders: IFolder[], userId: string): FolderPath[] {
  return folderPaths(folders.filter((f) => f.managers.includes(userId)));
}
