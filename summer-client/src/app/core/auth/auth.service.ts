import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { StorageService } from '../storage/storage.service';
import { UserService } from './user.service';
import { UserMonitoringService } from '../monitoring/user-monitoring.service';

export const TOKEN_KEY = 'tokenKey';

/** Hard-coded identity used while running on the mock API (מיכל גולן) — no login step. */
const MOCK_TOKEN = 'mock-token-u1';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly config = inject(APP_CONFIG);
  private readonly storage = inject(StorageService);
  private readonly users = inject(UserService);
  private readonly router = inject(Router);
  private readonly monitoring = inject(UserMonitoringService);

  token(): string | null {
    if (this.config.mockApi) return MOCK_TOKEN;
    return this.storage.get<string>(TOKEN_KEY);
  }

  isAuthenticated(): boolean {
    return !!this.token();
  }

  clearToken(): void {
    this.storage.remove(TOKEN_KEY);
  }

  /**
   * SAML SSO popup flow (spec §5): open the SSO page, wait for it to postMessage `{ user: { token } }`,
   * persist the token, load the user and resolve. Messages from any other origin are ignored.
   */
  login(): Promise<void> {
    const ssoOrigin = new URL(this.config.ssoUrl, location.href).origin;

    return new Promise<void>((resolve, reject) => {
      const popup = window.open(this.config.ssoUrl, 'summer-sso', this.config.ssoPopupFeatures);
      if (!popup) {
        reject(new Error('popup-blocked'));
        return;
      }

      const cleanup = () => {
        window.removeEventListener('message', onMessage);
        clearInterval(closedPoll);
      };

      const onMessage = async (event: MessageEvent) => {
        if (event.origin !== ssoOrigin) return;
        const token = event.data?.user?.token;
        if (typeof token !== 'string' || !token) return;
        cleanup();
        popup.close();
        this.storage.set(TOKEN_KEY, token);
        try {
          const user = await firstValueFrom(this.users.load());
          this.monitoring.track('login', { userId: user._id });
          resolve();
        } catch (e) {
          this.clearToken();
          reject(e);
        }
      };

      // Popup closed by the user without completing sign-in.
      const closedPoll = setInterval(() => {
        if (popup.closed) {
          cleanup();
          reject(new Error('popup-closed'));
        }
      }, 500);

      window.addEventListener('message', onMessage);
    });
  }

  logout(): void {
    this.clearToken();
    this.users.clear();
    this.router.navigate(['/login']);
  }
}
