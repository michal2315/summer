import { Routes } from '@angular/router';

export default [
  { path: ':id', loadComponent: () => import('./running-page.component').then((m) => m.RunningPageComponent), title: 'Summer · תמצית רצף' },
  {
    path: ':id/s/:sumaroonId',
    loadComponent: () => import('./running-sumaroon-page.component').then((m) => m.RunningSumaroonPageComponent),
    title: 'Summer · תמציתונית',
  },
] satisfies Routes;
