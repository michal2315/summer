import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, Subject, map, tap } from 'rxjs';
import { IAccessStats, IBulkResult, ISummariesLength, ISummariesResponse, ISummary, ISummarySearch, SummaryPayload } from '../models';
import { DOCX_MIME, XLSX_MIME, saveFile } from '../utils/save-file';
import { toHttpParams } from './http-params';

const BASE = '/api/summary';

const EMPTY_LENGTHS: ISummariesLength = { summary: 0, draft: 0, tagged: 0, favorite: 0 };

@Injectable({ providedIn: 'root' })
export class SummaryService {
  private readonly http = inject(HttpClient);

  /** Emits after any mutation so open lists/panels patch in place instead of refetching. */
  readonly changed$ = new Subject<ISummary>();
  readonly removed$ = new Subject<string>();

  get(id: string, isMine = false): Observable<ISummary> {
    return this.http.get<ISummary>(`${BASE}/${id}/${isMine}`);
  }

  /** Summaries (visible to the user) whose custom field `fieldId` equals `value`. */
  byField(fieldId: string, value: string): Observable<Pick<ISummary, '_id' | 'title'>[]> {
    return this.http.get<Pick<ISummary, '_id' | 'title'>[]>('/api/field/summaries', { params: { fieldId, value } });
  }

  /** How many published summaries `search` would find. */
  count(search: ISummarySearch): Observable<number> {
    return this.http.get<{ count: number }>(`${BASE}/count`, { params: toHttpParams(search) }).pipe(map((res) => res.count));
  }

  /** Visible summaries in the search's scope, and the ones matching it that permissions hide. */
  accessStats(scope: ISummarySearch): Observable<IAccessStats> {
    return this.http.get<IAccessStats>(`${BASE}/access-stats`, { params: toHttpParams(scope) });
  }

  search(userId: string, search: ISummarySearch): Observable<ISummariesResponse> {
    return this.http
      .get<{ summaries: ISummary[]; lengths: ISummariesLength | number }>(`${BASE}/user/${userId}`, { params: toHttpParams(search) })
      .pipe(
        // The backend has been seen returning `lengths` as a bare number; normalize to the object form.
        map((res) => ({
          summaries: res.summaries,
          lengths: typeof res.lengths === 'number' ? { ...EMPTY_LENGTHS, summary: res.lengths } : { ...EMPTY_LENGTHS, ...res.lengths },
        })),
      );
  }

  create(payload: SummaryPayload, files: File[]): Observable<ISummary> {
    return this.http.post<ISummary>(BASE, this.formData(payload, files)).pipe(tap((s) => this.changed$.next(s)));
  }

  update(payload: SummaryPayload, files: File[]): Observable<ISummary> {
    return this.http.put<ISummary>(BASE, this.formData(payload, files)).pipe(tap((s) => this.changed$.next(s)));
  }

  delete(id: string): Observable<unknown> {
    return this.http.delete(BASE, { body: { id } }).pipe(tap(() => this.removed$.next(id)));
  }

  setColor(summary: ISummary, color: string): Observable<unknown> {
    return this.http.put(`${BASE}/color`, { id: summary._id, summaryId: summary._id, color }).pipe(tap(() => this.changed$.next({ ...summary, color })));
  }

  toDraft(summary: ISummary): Observable<unknown> {
    return this.http.put(`${BASE}/to-draft`, { id: summary._id }).pipe(tap(() => this.changed$.next({ ...summary, isDraft: true })));
  }

  /** Add/remove labels on many summaries; applies to the ones you may edit and reports the rest. Callers reload their list. */
  bulkLabels(summaryIds: string[], add: string[], remove: string[]): Observable<IBulkResult> {
    return this.http.post<IBulkResult>(`${BASE}/bulk/labels`, { summaryIds, add, remove });
  }

  /** '' clears the colour. Like the other bulk calls, callers reload their list. */
  bulkColor(summaryIds: string[], color: string): Observable<IBulkResult> {
    return this.http.post<IBulkResult>(`${BASE}/bulk/color`, { summaryIds, color });
  }

  bulkToDraft(summaryIds: string[]): Observable<IBulkResult> {
    return this.http.post<IBulkResult>(`${BASE}/bulk/to-draft`, { summaryIds });
  }

  bulkDelete(summaryIds: string[]): Observable<IBulkResult> {
    return this.http.post<IBulkResult>(`${BASE}/bulk/delete`, { summaryIds }).pipe(tap((r) => r.applied.forEach((id) => this.removed$.next(id))));
  }

  /** Local-only change notification (e.g. favorite toggled via UserService, comment added). */
  patched(summary: ISummary): void {
    this.changed$.next(summary);
  }

  downloadAttachment(summaryId: string, fileName: string): Observable<void> {
    return this.http
      .get(`${BASE}/download`, { params: { fileName, summaryId }, responseType: 'blob' })
      .pipe(map((blob) => saveFile(blob, fileName)));
  }

  /** Empty .xlsx with one column per field name (Excel import template). */
  downloadTemplate(fieldNames: string[], fileName: string): Observable<void> {
    return this.http
      .post(`${BASE}/download/template`, { fieldNames }, { responseType: 'arraybuffer' })
      .pipe(map((buf) => saveFile(buf, fileName, XLSX_MIME)));
  }

  /** Export the given summaries, or every result of `search` when `all` is true. */
  exportExcel(body: { summariesId: string[]; all: boolean; search?: ISummarySearch }): Observable<void> {
    return this.http
      .post(`${BASE}/download/excel`, body, { responseType: 'arraybuffer' })
      .pipe(map((buf) => saveFile(buf, `summer-${new Date().toISOString().slice(0, 10)}.xlsx`, XLSX_MIME)));
  }

  /** Same selection as exportExcel, as a Word table between the user's title/intro/outro (plain text). */
  exportWord(body: { summariesId: string[]; all: boolean; search?: ISummarySearch; title: string; intro: string; outro: string }): Observable<void> {
    return this.http
      .post(`${BASE}/download/word`, body, { responseType: 'arraybuffer' })
      .pipe(map((buf) => saveFile(buf, `summer-${new Date().toISOString().slice(0, 10)}.docx`, DOCX_MIME)));
  }

  /** Bulk import. headersMap: Excel column header → summary field key (title/content/labels/… or a field id). */
  uploadExcel(req: { file: File; type: string; folder: string | null; permissions: string[]; headersMap: Record<string, string> }) {
    const fd = new FormData();
    fd.append('file', req.file, req.file.name);
    fd.append('type', req.type);
    if (req.folder) fd.append('folder', req.folder);
    for (const p of req.permissions) fd.append('permissions', p);
    fd.append('headersMap', JSON.stringify(req.headersMap));
    return this.http.post<{ created: number }>(`${BASE}/upload/excel`, fd);
  }

  updateTimelineTitle(summary: ISummary, timelineTitle: string): Observable<unknown> {
    return this.http
      .put(`${BASE}/updateTimelineTitle`, { id: summary._id, summaryId: summary._id, timelineTitle })
      .pipe(tap(() => this.changed$.next({ ...summary, timelineTitle })));
  }

  private formData(payload: SummaryPayload, files: File[]): FormData {
    const fd = new FormData();
    fd.append('summary', JSON.stringify(payload));
    for (const f of files) fd.append('files', f, f.name);
    return fd;
  }
}
