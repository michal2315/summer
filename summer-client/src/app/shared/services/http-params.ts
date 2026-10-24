import { HttpParams } from '@angular/common/http';

/** Object → HttpParams. Skips null/undefined/''/[]; arrays become repeated keys (a=1&a=2). */
export function toHttpParams(obj: object): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const v of value) if (v !== undefined && v !== null && v !== '') params = params.append(key, String(v));
    } else {
      params = params.set(key, String(value));
    }
  }
  return params;
}
