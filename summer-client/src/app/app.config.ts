import { registerLocaleData } from '@angular/common';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import he from '@angular/common/locales/he';
import { ApplicationConfig, LOCALE_ID, provideZoneChangeDetection } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideNzConfig } from 'ng-zorro-antd/core/config';
import { he_IL, provideNzI18n } from 'ng-zorro-antd/i18n';
import { provideNzIcons } from 'ng-zorro-antd/icon';
import { NzModalService } from 'ng-zorro-antd/modal';
import { provideQuillConfig } from 'ngx-quill/config';
import { routes } from './app.routes';
import { authInterceptor, errorInterceptor } from './core/http/interceptors';
import { ICONS } from './icons';

registerLocaleData(he);

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'enabled' })),
    // Order matters: auth headers → error toasts.
    provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])),
    provideAnimationsAsync(),
    { provide: LOCALE_ID, useValue: 'he' },
    provideNzI18n(he_IL),
    provideNzIcons(ICONS),
    NzModalService, // not root-provided in ng-zorro 19; app-wide confirms (delete, unsaved changes) need it

    provideNzConfig({ message: { nzTop: 24, nzMaxStack: 3 }, notification: { nzPlacement: 'bottomLeft' } }),
    provideQuillConfig({
      modules: {
        toolbar: [
          ['bold', 'italic', 'underline', 'strike'],
          ['blockquote', 'code-block'],
          [{ header: 1 }, { header: 2 }],
          [{ list: 'ordered' }, { list: 'bullet' }],
          [{ direction: 'rtl' }],
          [{ script: 'sub' }, { script: 'super' }],
          [{ indent: '-1' }, { indent: '+1' }],
          [{ header: [1, 2, 3, 4, 5, 6, false] }],
          [{ color: [] }, { background: [] }],
          [{ align: [] }],
          ['clean'],
          ['link'],
        ],
      },
    }),
  ],
};
