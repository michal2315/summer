import { InjectionToken } from '@angular/core';
import { environment } from '../../../environments/environment';

export interface SummariesTableField {
  name: string;
  displayName: string;
  width: string;
  type: 'date' | 'string';
}

export interface AppEnvironment {
  production: boolean;
  usersMail: string[];
  summariesTableFields: SummariesTableField[];
  summariesLimit: number;
  /** Avatar image template; `{username}` is substituted. Empty → initials only. */
  avatarUrl: string;
  userMonitoring: string;
  notificationsPollMs: number;
  maxToExport: number;
}

declare global {
  interface Window {
    _env_?: Partial<AppEnvironment>;
  }
}

export const APP_CONFIG = new InjectionToken<AppEnvironment>('APP_CONFIG', {
  providedIn: 'root',
  factory: () => ({ ...environment, ...(window._env_ ?? {}) }),
});
