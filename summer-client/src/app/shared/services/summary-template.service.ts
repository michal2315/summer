import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { ISummaryTemplate, SummaryTemplatePayload } from '../models';

const BASE = '/api/user/templates';

/** The current user's summary-form templates. Every mutation returns the full refreshed list. */
@Injectable({ providedIn: 'root' })
export class SummaryTemplateService {
  private readonly http = inject(HttpClient);
  private readonly _list = signal<ISummaryTemplate[]>([]);
  readonly list = this._list.asReadonly();

  load(): void {
    this.http.get<ISummaryTemplate[]>(BASE).subscribe((list) => this._list.set(list));
  }

  /** Saving under an existing name replaces that template. */
  save(template: SummaryTemplatePayload): Observable<ISummaryTemplate[]> {
    return this.http.post<ISummaryTemplate[]>(BASE, template).pipe(tap((list) => this._list.set(list)));
  }

  delete(id: string): Observable<ISummaryTemplate[]> {
    return this.http.delete<ISummaryTemplate[]>(`${BASE}/${id}`).pipe(tap((list) => this._list.set(list)));
  }
}
