import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';
import { IPouchFormat, IPouchPage, ISummary, ISummarySearch, PouchDoc, PouchFormatPayload } from '../models';
import { DOCX_MIME, saveFile } from '../utils/save-file';

const BASE = '/api/pouch-formats';

const norm = (s: string) => s.trim().toLowerCase();

/** Favourites first, then by name. */
const order = (list: IPouchFormat[]) => [...list].sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite) || a.name.localeCompare(b.name, 'he'));

/**
 * Pouch: the user's export formats — their own and the ones shared with them personally — cached for the whole app
 * (profile shelf, export menu). Every change answers with
 * the changed format, which replaces the cached one. Others' shared formats are browsed with `shared()`, outside the cache.
 */
@Injectable({ providedIn: 'root' })
export class PouchService {
  private readonly http = inject(HttpClient);
  private readonly _list = signal<IPouchFormat[] | null>(null);
  private loading = false;

  /** Null until loaded (call `ensureLoaded`). */
  readonly list = this._list.asReadonly();

  ensureLoaded(): void {
    if (this._list() !== null || this.loading) return;
    this.loading = true;
    this.http.get<IPouchFormat[]>(BASE).subscribe({
      next: (list) => {
        this._list.set(list);
        this.loading = false;
      },
      error: () => (this.loading = false),
    });
  }

  /** The user's formats (own and shared with them) whose name or owner has `text` in it, in the list's own order. */
  search(text: string): IPouchFormat[] {
    const q = norm(text);
    const list = this._list() ?? [];
    return q ? list.filter((f) => norm(f.name).includes(q) || (!f.isMine && norm(f.owner.fullName).includes(q))) : list;
  }

  /** Others' shared formats, newest change first, a page (30) at a time; `text` narrows by name or owner. */
  shared(text = '', offset = 0): Observable<IPouchFormat[]> {
    return this.http.get<IPouchFormat[]>(`${BASE}/shared`, { params: { q: text.trim(), offset } });
  }

  get(id: string): Observable<IPouchFormat> {
    return this.http.get<IPouchFormat>(`${BASE}/${id}`);
  }

  create(format: PouchFormatPayload): Observable<IPouchFormat> {
    return this.http.post<IPouchFormat>(BASE, format).pipe(tap((f) => this.put(f)));
  }

  /** The user's own private copy of a format (theirs or a shared one). */
  copy(id: string, name?: string): Observable<IPouchFormat> {
    return this.http.post<IPouchFormat>(`${BASE}/${id}/copy`, name ? { name } : {}).pipe(tap((f) => this.put(f)));
  }

  update(id: string, patch: Partial<PouchFormatPayload>): Observable<IPouchFormat> {
    return this.http.put<IPouchFormat>(`${BASE}/${id}`, patch).pipe(tap((f) => this.put(f)));
  }

  remove(id: string): Observable<void> {
    return this.http.delete(`${BASE}/${id}`).pipe(
      tap(() => this._list.update((l) => l?.filter((f) => f._id !== id) ?? l)),
      map(() => undefined),
    );
  }

  /** The summaries an export fills a format with (same selection as the Excel export); `capped`: there were more than the maximum. */
  exportData(body: { summariesId: string[]; all: boolean; search?: ISummarySearch }): Observable<{ summaries: ISummary[]; capped: boolean }> {
    return this.http.post<{ summaries: ISummary[]; capped: boolean }>('/api/summary/export/data', body);
  }

  /** A filled-in document → a downloaded Word file. */
  downloadDocx(doc: PouchDoc, page: IPouchPage, fileName: string): Observable<void> {
    return this.http
      .post(`${BASE}/docx`, { doc, page, title: fileName }, { responseType: 'arraybuffer' })
      .pipe(map((buf) => saveFile(buf, `${fileName || 'summer'}.docx`, DOCX_MIME)));
  }

  private put(f: IPouchFormat): void {
    this._list.update((list) => (list ? order([f, ...list.filter((x) => x._id !== f._id)]) : list));
  }
}
