import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { NzModalService } from 'ng-zorro-antd/modal';
import { Observable, catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { SILENT_ERRORS } from '../../core/http/http-context';
import { IWhatsNew } from '../models';

export interface Release extends IWhatsNew {
  html: string;
}

/** "What's new" release notes. The modal itself is lazy-loaded so it stays out of the initial bundle. */
@Injectable({ providedIn: 'root' })
export class WhatsNewService {
  private readonly http = inject(HttpClient);
  private readonly modal = inject(NzModalService);
  private checked = false;

  /** Open once per session if there is an unacknowledged release. */
  showIfUnseen(): void {
    if (this.checked) return;
    this.checked = true;
    this.http
      .get<IWhatsNew[]>('/api/whats-new', { context: new HttpContext().set(SILENT_ERRORS, true) })
      .pipe(catchError(() => of([])))
      .subscribe((list) => list.some((r) => !r.isAcknowledged) && this.open());
  }

  async open(): Promise<void> {
    const { WhatsNewModalComponent } = await import('./whats-new-modal/whats-new-modal.component');
    this.modal.create({ nzTitle: 'מה חדש ב-Summer', nzContent: WhatsNewModalComponent, nzFooter: null, nzWidth: 620 });
  }

  /** Release list (newest first) with each version's HTML from public/whats-new/<version>.html. */
  releases(): Observable<Release[]> {
    return this.http.get<IWhatsNew[]>('/api/whats-new').pipe(
      switchMap((list) => {
        if (!list.length) return of([] as Release[]);
        const sorted = [...list].sort((a, b) => b.date.localeCompare(a.date));
        return forkJoin(
          sorted.map((r) =>
            this.http.get(`whats-new/${encodeURIComponent(r.version)}.html`, { responseType: 'text' }).pipe(
              catchError(() => of('')),
              map((html): Release => ({ ...r, html })),
            ),
          ),
        );
      }),
    );
  }

  acknowledge(version: string) {
    return this.http.post('/api/whats-new/acknowledge', { version });
  }
}
