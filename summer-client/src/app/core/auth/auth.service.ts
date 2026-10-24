import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, of, tap } from 'rxjs';
import { SILENT_ERRORS } from '../http/http-context';
import { StorageService } from '../storage/storage.service';

export const TOKEN_KEY = 'tokenKey';

/**
 * Signs in automatically: the token comes from the server's dev token endpoint, which issues one for its
 * default user (DEV_LOGIN_USER in summer-server/.env). No SSO, no login page.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly storage = inject(StorageService);

  token(): string | null {
    return this.storage.get<string>(TOKEN_KEY);
  }

  clearToken(): void {
    this.storage.remove(TOKEN_KEY);
  }

  /** The stored token, or a fresh one from the server. */
  ensureToken(): Observable<string> {
    const token = this.token();
    if (token) return of(token);
    return this.http.get<{ token: string }>('/api/auth/dev-token', { context: new HttpContext().set(SILENT_ERRORS, true) }).pipe(
      map((res) => res.token),
      tap((t) => this.storage.set(TOKEN_KEY, t)),
    );
  }
}
