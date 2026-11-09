import { inject } from '@angular/core';
import { ResolveFn, Router, Routes } from '@angular/router';
import { catchError, of } from 'rxjs';
import { pendingChangesGuard } from '../core/auth/guards';
import { ISummary } from '../shared/models';
import { SummaryService } from '../shared/services/summary.service';

const summaryResolver: ResolveFn<ISummary | undefined> = (route) => {
  const router = inject(Router);
  return inject(SummaryService)
    .get(route.paramMap.get('id')!, true)
    .pipe(
      catchError(() => {
        router.navigate(['/not-found'], { skipLocationChange: true });
        return of(undefined);
      }),
    );
};

export default [
  {
    path: '',
    loadComponent: () => import('../features/hierarchy/hierarchy-page/hierarchy-page.component').then((m) => m.HierarchyPageComponent),
    title: 'Summer · תמציות',
  },
  {
    path: 'new',
    loadComponent: () => import('../features/summaries/create-summary/create-summary.component').then((m) => m.CreateSummaryComponent),
    canDeactivate: [pendingChangesGuard],
    title: 'Summer · כתיבת תמצית',
  },
  {
    path: ':id/edit',
    loadComponent: () => import('../features/summaries/create-summary/create-summary.component').then((m) => m.CreateSummaryComponent),
    resolve: { summary: summaryResolver },
    canDeactivate: [pendingChangesGuard],
    title: 'Summer · עריכת תמצית',
  },
  { path: ':id', loadComponent: () => import('../features/summaries/summary-page/summary-page.component').then((m) => m.SummaryPageComponent), title: 'Summer · תמצית' },
] satisfies Routes;
