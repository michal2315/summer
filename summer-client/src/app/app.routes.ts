import { Routes } from '@angular/router';
import { userGuard } from './core/auth/guards';
import { LayoutComponent } from './core/layout/layout.component';
import { dashboardGuard } from './features/dashboard/dashboard.guard';

const status = (kind: string) => ({
  loadComponent: () => import('./core/pages/status-page.component').then((m) => m.StatusPageComponent),
  data: { kind },
});

export const routes: Routes = [
  { path: 'server-error', ...status('server-error'), title: 'Summer · שגיאה' },
  { path: 'unauthorized', ...status('unauthorized'), title: 'Summer · אין הרשאה' },
  {
    path: '',
    component: LayoutComponent,
    canActivate: [userGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'summaries' },
      { path: 'feed', redirectTo: 'summaries' },
      { path: 'summaries', loadChildren: () => import('./features/summaries/summaries.routes') },
      {
        path: 'profile/:userId',
        loadComponent: () => import('./features/profile/profile.component').then((m) => m.ProfileComponent),
        title: 'Summer · פרופיל',
      },
      { path: 'user-not-found', ...status('user-not-found') },
      { path: 'running', loadChildren: () => import('./features/running/running.routes') },
      { path: 'collections', loadChildren: () => import('./features/collections/collections.routes') },
      {
        path: 'hierarchy',
        loadComponent: () => import('./features/hierarchy/hierarchy-page.component').then((m) => m.HierarchyPageComponent),
        title: 'Summer · היררכיה',
      },
      { path: 'notifications', loadChildren: () => import('./features/notifications/notifications.routes') },
      {
        path: 'permissions',
        loadComponent: () => import('./features/permissions/permissions-page.component').then((m) => m.PermissionsPageComponent),
        title: 'Summer · הרשאות',
      },
      {
        path: 'dashboard',
        canActivate: [dashboardGuard],
        loadComponent: () => import('./features/dashboard/dashboard-page.component').then((m) => m.DashboardPageComponent),
        title: 'Summer · דשבורד',
      },
      {
        path: 'extension',
        children: [
          { path: '', loadComponent: () => import('./features/extension/extension.component').then((m) => m.ExtensionDetailsComponent) },
          { path: 'install', loadComponent: () => import('./features/extension/extension.component').then((m) => m.InstallExtensionComponent) },
        ],
        title: 'Summer · תוסף לדפדפן',
      },
      { path: 'not-found', ...status('not-found') },
      { path: '**', ...status('not-found') },
    ],
  },
];
