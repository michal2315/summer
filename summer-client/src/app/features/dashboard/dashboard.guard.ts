import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { PermissionService } from '../../shared/services/permission.service';

/** Only users in at least one dashboard-permitted group may enter. */
export const dashboardGuard: CanActivateFn = () => {
  const router = inject(Router);
  return inject(PermissionService)
    .dashboardAccess()
    .pipe(
      map((ok) => ok || router.createUrlTree(['/summaries'])),
      catchError(() => of(router.createUrlTree(['/summaries']))),
    );
};
