import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Observable, catchError, debounceTime, distinctUntilChanged, finalize, of, shareReplay, switchMap, tap } from 'rxjs';
import { SILENT_ERRORS } from '../../core/http/http-context';
import { ICapsule } from '../models';
import { normalizeCapsuleName } from '../utils/capsules';

/**
 * Capsules from the external capsules service (via /api/capsules). Everything fetched is remembered, so chips,
 * highlighting and the search box can resolve ids and `#names` synchronously once they have been seen.
 */
@Injectable({ providedIn: 'root' })
export class CapsuleService {
  private readonly http = inject(HttpClient);

  private readonly known = signal(new Map<string, ICapsule>());
  /** Every capsule seen so far, by id; a new Map whenever more arrive. */
  readonly cache = this.known.asReadonly();
  private readonly names = computed(() => new Map([...this.known().values()].map((c) => [normalizeCapsuleName(c.name), c])));
  private readonly searches = new Map<string, Observable<ICapsule[]>>();
  /** ids / names already asked for, so a missing capsule isn't fetched again on every change. */
  private readonly asked = new Set<string>();

  byId(id: string): ICapsule | undefined {
    return this.known().get(id);
  }

  byName(name: string): ICapsule | undefined {
    return this.names().get(normalizeCapsuleName(name));
  }

  /** Autocomplete by name (prefix matches first); repeated queries are served from memory. */
  search(q: string): Observable<ICapsule[]> {
    const key = normalizeCapsuleName(q);
    let req = this.searches.get(key);
    if (!req) {
      req = this.http.get<ICapsule[]>('/api/capsules', { params: { q: key } }).pipe(
        tap((list) => this.remember(list)),
        catchError(() => {
          this.searches.delete(key);
          return of([] as ICapsule[]);
        }),
        shareReplay(1),
      );
      this.searches.set(key, req);
    }
    return req;
  }

  /** Answered from memory when the query was searched before (so the list doesn't flash a loading state). */
  cachedSearch(q: string): boolean {
    return this.searches.has(normalizeCapsuleName(q));
  }

  /** Fetch the capsules among these that haven't been seen yet (search text from the URL, saved queries and rules). */
  ensure(refs: { ids?: string[]; names?: string[] }): void {
    const ids = [...new Set(refs.ids ?? [])].filter((id) => !this.byId(id) && !this.asked.has(`id:${id}`));
    const names = [...new Set((refs.names ?? []).map(normalizeCapsuleName))].filter((n) => n && !this.byName(n) && !this.asked.has(`name:${n}`));
    if (!ids.length && !names.length) return;
    ids.forEach((id) => this.asked.add(`id:${id}`));
    names.forEach((n) => this.asked.add(`name:${n}`));
    this.http
      .get<ICapsule[]>('/api/capsules', {
        params: { ids: ids.join(','), names: names.join(',') },
        context: new HttpContext().set(SILENT_ERRORS, true),
      })
      .subscribe({ next: (list) => this.remember(list), error: () => undefined });
  }

  private remember(list: ICapsule[]) {
    if (!list.length) return;
    this.known.update((m) => new Map([...m, ...list.map((c): [string, ICapsule] => [c._id, c])]));
  }
}

/**
 * Live autocomplete for whatever follows a `#`: `query` null = closed. Call in an injection context.
 * `loading` is true only while a query that was never searched before is on its way.
 */
export function capsuleSuggestions(query: Signal<string | null>): { items: Signal<ICapsule[]>; loading: Signal<boolean> } {
  const service = inject(CapsuleService);
  const loading = signal(false);
  const items = toSignal(
    toObservable(query).pipe(
      debounceTime(100),
      distinctUntilChanged(),
      switchMap((q) => {
        if (q === null) return of([] as ICapsule[]);
        loading.set(!service.cachedSearch(q));
        return service.search(q).pipe(finalize(() => loading.set(false)));
      }),
    ),
    { initialValue: [] as ICapsule[] },
  );
  return { items, loading: loading.asReadonly() };
}
