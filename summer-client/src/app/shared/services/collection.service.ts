import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, Subject, map, of, tap } from 'rxjs';
import { CollectionPayload, ICollection, ICollectionRef, ISummariesLength, ISummariesResponse, ISummary, ISummarySearch } from '../models';
import { toHttpParams } from './http-params';

const BASE = '/api/collection';

export interface CollectionsQuery {
  skip: number;
  text?: string;
  /** false → only collections the user manages */
  all?: boolean;
  /** pinned/favorite collections first */
  getPrioritized?: boolean;
}

@Injectable({ providedIn: 'root' })
export class CollectionService {
  private readonly http = inject(HttpClient);

  /** Emits after create/edit/delete/add so open lists refresh. */
  readonly changed$ = new Subject<void>();

  get(id: string): Observable<ICollection> {
    return this.http.get<ICollection>(`${BASE}/${id}`);
  }

  /** Collections (visible to the user) whose name contains `text`. */
  byName(text: string): Observable<ICollectionRef[]> {
    return this.http.get<ICollectionRef[]>(`${BASE}/collectionName/${encodeURIComponent(text)}`);
  }

  byIds(ids: string[]): Observable<ICollectionRef[]> {
    if (!ids.length) return of([]);
    return this.http.get<ICollectionRef[]>(`${BASE}/ids`, { params: { _ids: ids.join(',') } });
  }

  byUser(userId: string, query: CollectionsQuery): Observable<ICollection[]> {
    return this.http.get<ICollection[]>(`${BASE}/user/${userId}`, { params: toHttpParams(query) });
  }

  summaries(collectionId: string, search: ISummarySearch): Observable<ISummariesResponse> {
    return this.http
      .get<{ summaries: ISummary[]; lengths?: ISummariesLength | number; total?: number }>(`${BASE}/summaries/${collectionId}`, {
        params: toHttpParams(search),
      })
      .pipe(
        // Seen as { summaries, total } and { summaries, lengths } — normalize to the feed's shape.
        map((res) => {
          const total = typeof res.lengths === 'number' ? res.lengths : (res.lengths?.summary ?? res.total ?? res.summaries.length);
          return { summaries: res.summaries, lengths: { summary: total, draft: 0, tagged: 0, favorite: 0 } };
        }),
      );
  }

  create(payload: CollectionPayload): Observable<ICollection> {
    return this.http.post<ICollection>(`${BASE}/create`, payload).pipe(tap(() => this.changed$.next()));
  }

  edit(id: string, payload: CollectionPayload): Observable<ICollection> {
    return this.http.post<ICollection>(`${BASE}/edit/${id}`, payload).pipe(tap(() => this.changed$.next()));
  }

  addSummaries(collectionIds: string[], summaryIds: string[]): Observable<unknown> {
    return this.http.post(`${BASE}/add`, { collectionIds, summaryIds }).pipe(tap(() => this.changed$.next()));
  }

  delete(id: string): Observable<unknown> {
    return this.http.delete(`${BASE}/${id}`).pipe(tap(() => this.changed$.next()));
  }
}
