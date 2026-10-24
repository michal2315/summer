import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { CanActivateFn, CanDeactivateFn, Router } from '@angular/router';
import { NzModalService } from 'ng-zorro-antd/modal';
import { Observable, catchError, map, of, switchMap } from 'rxjs';
import { AuthService } from './auth.service';
import { UserService } from './user.service';

/** Shell guard: sign in automatically, then load the user (403 → unauthorized, other failures → server-error). */
export const userGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const users = inject(UserService);
  const router = inject(Router);
  const signIn = () => auth.ensureToken().pipe(switchMap(() => users.ensureLoaded()));

  return signIn().pipe(
    // A stale stored token (e.g. the server's secret changed): drop it and sign in once more.
    catchError((e: HttpErrorResponse) => {
      if (e.status !== 401) throw e;
      auth.clearToken();
      users.clear();
      return signIn();
    }),
    map(() => true),
    catchError((e: HttpErrorResponse) => of(router.createUrlTree([e.status === 403 ? '/unauthorized' : '/server-error']))),
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
