import { inject } from '@angular/core';
import { ResolveFn, Router, Routes } from '@angular/router';
import { catchError, of } from 'rxjs';
import { pendingChangesGuard } from '../../core/auth/guards';
import { ISummary } from '../../shared/models';
import { SummaryService } from '../../shared/services/summary.service';

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
  { path: '', loadComponent: () => import('./summary-feed.component').then((m) => m.SummaryFeedComponent), title: 'Summer · סיכומים' },
  {
    path: 'new',
    loadComponent: () => import('./create-summary/create-summary.component').then((m) => m.CreateSummaryComponent),
    canDeactivate: [pendingChangesGuard],
    title: 'Summer · כתיבת סיכום',
  },
  {
    path: ':id/edit',
    loadComponent: () => import('./create-summary/create-summary.component').then((m) => m.CreateSummaryComponent),
    resolve: { summary: summaryResolver },
    canDeactivate: [pendingChangesGuard],
    title: 'Summer · עריכת סיכום',
  },
  { path: ':id', loadComponent: () => import('./summary-page.component').then((m) => m.SummaryPageComponent), title: 'Summer · סיכום' },
] satisfies Routes;
