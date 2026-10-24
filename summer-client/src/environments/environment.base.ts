import { AppEnvironment } from '../app/core/config/app-config';

/**
 * Shared defaults. Kept out of environment.ts because angular.json fileReplacements swaps that file —
 * importing it from environment.development.ts would import itself.
 */
export const baseEnvironment: AppEnvironment = {
  production: true,
  usersMail: ['support@example-university.edu'],
  summariesTableFields: [
    { name: 'eventDate', displayName: 'תאריך האירוע', width: '20%', type: 'date' },
    { name: 'title', displayName: 'כותרת', width: '20%', type: 'string' },
    { name: 'content', displayName: 'סיכום', width: '50%', type: 'string' },
  ],
  summariesLimit: 20,
  avatarUrl: 'https://avatars.example-university.edu/{username}?default=true',
  userMonitoring: 'https://monitoring.example-university.edu/api/event',
  notificationsPollMs: 60_000,
  maxToExport: 500,
};
