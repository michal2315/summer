import { Routes } from '@angular/router';

export default [
  { path: '', loadComponent: () => import('../features/collections/collections-page/collections-page.component').then((m) => m.CollectionsPageComponent), title: 'Summer · לקטים' },
  {
    path: ':id',
    loadComponent: () => import('../features/collections/collection-summaries-page/collection-summaries-page.component').then((m) => m.CollectionSummariesPageComponent),
    title: 'Summer · לקט',
  },
] satisfies Routes;
