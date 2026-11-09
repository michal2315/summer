import { Routes } from '@angular/router';

export default [
  { path: ':id', loadComponent: () => import('../features/running/running-page/running-page.component').then((m) => m.RunningPageComponent), title: 'Summer · תמצית רצף' },
  {
    path: ':id/s/:sumaroonId',
    loadComponent: () => import('../features/running/running-sumaroon-page/running-sumaroon-page.component').then((m) => m.RunningSumaroonPageComponent),
    title: 'Summer · תמציתונית',
  },
] satisfies Routes;
