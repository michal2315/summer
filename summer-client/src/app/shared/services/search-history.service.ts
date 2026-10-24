import { Injectable, inject, signal } from '@angular/core';
import { StorageService } from '../../core/storage/storage.service';
import { ISummarySearch } from '../models';

const KEY = 'previousSearches';
const MAX_STORED = 20;

/** Recent searches in localStorage (spec §11.1): each entry btoa(encodeURIComponent(JSON)), deduped, newest first. */
@Injectable({ providedIn: 'root' })
export class SearchHistoryService {
  private readonly storage = inject(StorageService);
  private readonly _recent = signal<ISummarySearch[]>(this.read());

  readonly recent = this._recent.asReadonly();

  add(search: ISummarySearch): void {
    const clean = stripPaging(search);
    if (!clean.text?.trim()) return;
    const encoded = encode(clean);
    const stored = (this.storage.get<string[]>(KEY) ?? []).filter((e) => e !== encoded);
    stored.unshift(encoded);
    this.storage.set(KEY, stored.slice(0, MAX_STORED));
    this._recent.set(this.read());
  }

  private read(): ISummarySearch[] {
    return (this.storage.get<string[]>(KEY) ?? []).flatMap((e) => {
      try {
        return [JSON.parse(decodeURIComponent(atob(e))) as ISummarySearch];
      } catch {
        return [];
      }
    });
  }
}

export function stripPaging({ skip, limit, isPin, ...rest }: ISummarySearch): ISummarySearch {
  return rest;
}

const encode = (s: ISummarySearch) => btoa(encodeURIComponent(JSON.stringify(s)));
