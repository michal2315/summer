import { Routes } from '@angular/router';
import { pendingChangesGuard } from '../core/auth/guards';

export default [
  {
    path: '',
    loadComponent: () => import('../features/notifications/notifications-settings/notifications-settings.component').then((m) => m.NotificationsSettingsComponent),
    title: 'Summer · ניהול התראות',
  },
  {
    path: 'create',
    loadComponent: () => import('../features/notifications/create-notification/create-notification.component').then((m) => m.CreateNotificationComponent),
    canDeactivate: [pendingChangesGuard],
    title: 'Summer · התראה חדשה',
  },
  {
    path: ':id/edit',
    loadComponent: () => import('../features/notifications/create-notification/create-notification.component').then((m) => m.CreateNotificationComponent),
    canDeactivate: [pendingChangesGuard],
    title: 'Summer · עריכת התראה',
  },
] satisfies Routes;
