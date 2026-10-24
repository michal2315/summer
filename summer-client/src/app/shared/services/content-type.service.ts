import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { shareReplay } from 'rxjs';
import { IContentType, IField } from '../models';

/** Content types (lecture, video, textbook…) and the reusable custom fields they are made of. Loaded once. */
@Injectable({ providedIn: 'root' })
export class ContentTypeService {
  private readonly http = inject(HttpClient);

  readonly list$ = this.http.get<IContentType[]>('/api/content-type').pipe(shareReplay(1));
  readonly fields$ = this.http.get<IField[]>('/api/field').pipe(shareReplay(1));

  readonly list = toSignal(this.list$, { initialValue: [] as IContentType[] });
  readonly fields = toSignal(this.fields$, { initialValue: [] as IField[] });
  readonly fieldsById = computed(() => new Map(this.fields().map((f) => [f._id, f])));
}
