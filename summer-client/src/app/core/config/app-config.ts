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
  /** Serve /api/* from the in-browser mock (src/app/mock) instead of the network. */
  mockApi: boolean;
  usersMail: string[];
  summariesTableFields: SummariesTableField[];
  summariesLimit: number;
  ssoUrl: string;
  /** window.open features for the SSO popup. The real SAML flow uses a zero-size window. */
  ssoPopupFeatures: string;
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
