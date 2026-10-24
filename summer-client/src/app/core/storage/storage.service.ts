import { Injectable } from '@angular/core';

/** JSON get/set over local/session storage. Never throws (private mode, quota, corrupt values). */
@Injectable({ providedIn: 'root' })
export class StorageService {
  get<T>(key: string, area: 'local' | 'session' = 'local'): T | null {
    try {
      const raw = this.area(area).getItem(key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch {
      return null;
    }
  }

  set(key: string, value: unknown, area: 'local' | 'session' = 'local'): void {
    try {
      this.area(area).setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable — non-fatal */
    }
  }

  remove(key: string, area: 'local' | 'session' = 'local'): void {
    try {
      this.area(area).removeItem(key);
    } catch {
      /* ignore */
    }
  }

  private area(area: 'local' | 'session'): Storage {
    return area === 'local' ? localStorage : sessionStorage;
  }
}
