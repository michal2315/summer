import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

/** Reusable labels: autocomplete only (labels are created by saving a summary that uses them). */
@Injectable({ providedIn: 'root' })
export class LabelService {
  private readonly http = inject(HttpClient);

  /** Label names containing `text`, 20 per page. */
  search(text: string, skip = 0): Observable<string[]> {
    return this.http.get<string[]>('/api/labels', { params: { text, skip } });
  }
}
