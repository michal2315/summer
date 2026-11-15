import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { IMailPreferences } from '../../shared/models';

/** The user's e-mail switches on the notifications page. Alerts themselves live on queries (QueryService). */
@Injectable({ providedIn: 'root' })
export class NotificationsSettingsService {
  private readonly http = inject(HttpClient);
  readonly preferences = signal<IMailPreferences | null>(null);

  loadPreferences(): void {
    this.http.get<IMailPreferences>('/api/notifications/preferences').subscribe((p) => this.preferences.set(p));
  }

  /** Optimistic; the server's answer replaces the local copy, a failure restores it. */
  setPreference(key: 'mailAlerts' | 'mailActivity', value: boolean): void {
    const before = this.preferences();
    if (before) this.preferences.set({ ...before, [key]: value });
    this.http.put<IMailPreferences>('/api/notifications/preferences', { [key]: value }).subscribe({
      next: (p) => this.preferences.set(p),
      error: () => this.preferences.set(before),
    });
  }
}
