import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { CanActivateFn, CanDeactivateFn, Router } from '@angular/router';
import { NzModalService } from 'ng-zorro-antd/modal';
import { Observable, catchError, map, of } from 'rxjs';
import { AuthService } from './auth.service';
import { UserService } from './user.service';

/** Shell guard: no token → /login?RelayState=…; then load the user (401 → login, 403 → unauthorized, else → server-error). */
export const userGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const users = inject(UserService);
  const router = inject(Router);
  const toLogin = () => router.createUrlTree(['/login'], { queryParams: { RelayState: state.url } });

  if (!auth.isAuthenticated()) return toLogin();

  return users.ensureLoaded().pipe(
    map(() => true),
    catchError((e: HttpErrorResponse) => {
      if (e.status === 401) {
        auth.clearToken();
        return of(toLogin());
      }
      return of(router.createUrlTree([e.status === 403 ? '/unauthorized' : '/server-error']));
    }),
  );
};

export interface HasPendingChanges {
  /** true when it is safe to leave without asking (pristine or already saved). */
  canLeave(): boolean;
}

export const pendingChangesGuard: CanDeactivateFn<HasPendingChanges> = (component) => {
  if (component.canLeave()) return true;
  const modal = inject(NzModalService);
  return new Observable<boolean>((sub) => {
    modal.confirm({
      nzTitle: 'לצאת ללא שמירה?',
      nzContent: 'השינויים שביצעת לא יישמרו. ליציאה ללא שמירה לחץ אישור.',
      nzOkText: 'אישור',
      nzCancelText: 'ביטול',
      nzOkDanger: true,
      nzOnOk: () => {
        sub.next(true);
        sub.complete();
      },
      nzOnCancel: () => {
        sub.next(false);
        sub.complete();
      },
    });
  });
};
