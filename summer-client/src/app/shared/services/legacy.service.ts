import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { ILegacyItem, ILegacyMoveResult, ILegacyOverview, ILegacyResult } from '../models';
import { FolderService } from './folder.service';

const BASE = '/api/legacy';

/**
 * The staging page's API: sorting the collections from the old Summer out of the legacy root. Mutations go through
 * FolderService.changed$ so the side-nav tree refreshes too.
 */
@Injectable({ providedIn: 'root' })
export class LegacyService {
  private readonly http = inject(HttpClient);
  private readonly folders = inject(FolderService);

  overview(): Observable<ILegacyOverview> {
    return this.http.get<ILegacyOverview>(BASE);
  }

  items(collectionId: string): Observable<ILegacyItem[]> {
    return this.http.get<ILegacyItem[]>(`${BASE}/${collectionId}/items`);
  }

  /** Move summaries out of the collection into `to` (a folder outside the legacy root the user manages). */
  moveItems(collectionId: string, to: string, summaryIds: string[]): Observable<ILegacyMoveResult> {
    return this.http.post<ILegacyMoveResult>(`${BASE}/${collectionId}/items/move`, { to, summaryIds }).pipe(tap(() => this.folders.changed$.next()));
  }

  /** Take summaries out of the collection without placing them anywhere. */
  releaseItems(collectionId: string, summaryIds: string[]): Observable<ILegacyResult> {
    return this.http.post<ILegacyResult>(`${BASE}/${collectionId}/items/release`, { summaryIds }).pipe(tap(() => this.folders.changed$.next()));
  }

  /** Undo: put summaries taken out of the collection back in. */
  restoreItems(collectionId: string, summaryIds: string[]): Observable<ILegacyResult> {
    return this.http.post<ILegacyResult>(`${BASE}/${collectionId}/items/restore`, { summaryIds }).pipe(tap(() => this.folders.changed$.next()));
  }

  /** DEV ONLY: put the demo collections back to the start (sunrise). */
  demoReset(): Observable<unknown> {
    return this.http.post(`${BASE}/demo-reset`, {}).pipe(tap(() => this.folders.changed$.next()));
  }

  /** Undo moving a whole collection out: back into the legacy root. */
  restoreCollection(collectionId: string): Observable<unknown> {
    return this.http.post(`${BASE}/${collectionId}/restore`, {}).pipe(tap(() => this.folders.changed$.next()));
  }
}
