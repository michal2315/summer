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
  /** Sunny team (helpdesk) sites, opened from the side nav. Empty → that button is disabled. */
  helpdeskUrl: string;
  suggestionsUrl: string;
  summariesTableFields: SummariesTableField[];
  summariesLimit: number;
  /** Avatar image template; `{username}` is substituted. Empty → initials only. */
  avatarUrl: string;
  userMonitoring: string;
  notificationsPollMs: number;
  maxToExport: number;
  /** Feature flags: off hides the feature's entry points. Override per deployment in env-config.js (`features: { pouch: true }`). */
  features: AppFeatures;
}

export interface AppFeatures {
  /** Pouch: personal export formats (export menu, profile shelf). */
  pouch: boolean;
}

declare global {
  interface Window {
    _env_?: Partial<AppEnvironment>;
  }
}

export const APP_CONFIG = new InjectionToken<AppEnvironment>('APP_CONFIG', {
  providedIn: 'root',
  factory: () => {
    const env = window._env_ ?? {};
    // Flags merge one by one, so overriding one doesn't switch the others back to off.
    return { ...environment, ...env, features: { ...environment.features, ...(env.features ?? {}) } };
  },
});
