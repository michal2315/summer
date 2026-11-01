import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { SILENT_ERRORS } from '../../core/http/http-context';

export interface ExtensionInfo {
  id: string;
  version: string;
}

/**
 * The browser extension package the server publishes. Following CRX_URL (a plain navigation, never an XHR) lets a
 * browser whose ExtensionInstallSources policy allows this site show its own "Add extension" dialog; anywhere else
 * the file is just downloaded.
 */
export const CRX_URL = '/api/extension/summer-extension.crx';

@Injectable({ providedIn: 'root' })
export class ExtensionService {
  /** undefined while loading; null when no package is published. */
  readonly info = toSignal<ExtensionInfo | null | undefined>(
    inject(HttpClient)
      .get<ExtensionInfo>('/api/extension', { context: new HttpContext().set(SILENT_ERRORS, true) })
      .pipe(catchError(() => of(null))),
    { initialValue: undefined },
  );
}
