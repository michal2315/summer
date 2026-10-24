import { Routes } from '@angular/router';

export default [
  { path: '', loadComponent: () => import('./collections-page.component').then((m) => m.CollectionsPageComponent), title: 'Summer · אוספים' },
  {
    path: ':id',
    loadComponent: () => import('./collection-summaries-page.component').then((m) => m.CollectionSummariesPageComponent),
    title: 'Summer · אוסף',
  },
] satisfies Routes;
