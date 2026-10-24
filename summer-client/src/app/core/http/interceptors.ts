import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { NzMessageService } from 'ng-zorro-antd/message';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { UserService } from '../auth/user.service';
import { APP_CONFIG } from '../config/app-config';
import { SILENT_ERRORS } from './http-context';

const isApi = (url: string) => url.startsWith('/api/') || url.startsWith('api/');

/** Adds `authorization: bearer <token>` and the `_id` header (except on GET /api/user, which is what resolves it). */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isApi(req.url)) return next(req);
  const token = inject(AuthService).token();
  const userId = inject(UserService).userId();
  let headers = req.headers;
  if (token) headers = headers.set('authorization', `bearer ${token}`);
  const isLoadUser = req.method === 'GET' && req.url.replace(/\/$/, '') === '/api/user';
  if (userId && !isLoadUser) headers = headers.set('_id', userId);
  return next(req.clone({ headers }));
};

const ERROR_TEXT: Record<number, string> = {
  0: 'אין חיבור לשרת',
  400: 'הבקשה אינה תקינה',
  403: 'אין לך הרשאה לפעולה זו',
  404: 'הפריט לא נמצא',
  409: 'הפריט כבר קיים',
  413: 'הקובץ גדול מדי',
};

/** Funnels 4xx/5xx into short Hebrew toasts; a 401 mid-session sends the user back to login. */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isApi(req.url)) return next(req);
  const message = inject(NzMessageService);
  const auth = inject(AuthService);
  const router = inject(Router);
  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      if (req.context.get(SILENT_ERRORS)) return throwError(() => err);
      if (err.status === 401) {
        auth.clearToken();
        router.navigate(['/login'], { queryParams: { RelayState: router.url } });
      } else {
        message.error(ERROR_TEXT[err.status] ?? 'אירעה שגיאה, נסו שוב מאוחר יותר');
      }
      return throwError(() => err);
    }),
  );
};

/** Dev only: answers /api/* from the in-browser mock backend (lazy chunk — never shipped when mockApi is off). */
export const mockApiInterceptor: HttpInterceptorFn = (req, next) => {
  if (!inject(APP_CONFIG).mockApi || !isApi(req.url)) return next(req);
  return from(import('../../mock/mock-backend')).pipe(switchMap((m) => m.handle(req)));
};
