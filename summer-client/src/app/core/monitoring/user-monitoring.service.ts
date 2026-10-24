import { Injectable, inject } from '@angular/core';
import { APP_CONFIG } from '../config/app-config';

/** Fire-and-forget user-action logging to the external monitoring endpoint. Never blocks or throws. */
@Injectable({ providedIn: 'root' })
export class UserMonitoringService {
  private readonly url = inject(APP_CONFIG).userMonitoring;

  track(action: string, data: Record<string, unknown> = {}): void {
    if (!this.url) return;
    try {
      fetch(this.url, {
        method: 'POST',
        keepalive: true,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app: 'summer', action, ...data, at: new Date().toISOString() }),
      }).catch(() => undefined);
    } catch {
      /* ignore */
    }
  }
}
