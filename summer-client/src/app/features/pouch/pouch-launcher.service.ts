import { Injectable, inject } from '@angular/core';
import { NzModalService } from 'ng-zorro-antd/modal';
import { Observable, from, switchMap } from 'rxjs';
import { APP_CONFIG } from '../../core/config/app-config';
import { IPouchFormat } from '../../shared/models';
import type { PouchExportData } from './pouch-export-modal/pouch-export-modal.component';

/** Near full screen: the editor needs the room. */
const BIG_MODAL = {
  nzWidth: '96vw',
  nzStyle: { top: '2vh', paddingBottom: '0', maxWidth: '1680px' },
  nzBodyStyle: { padding: '0', height: '96vh', overflow: 'hidden' },
  nzFooter: null,
  nzClosable: false,
  nzMaskClosable: false,
  nzKeyboard: false,
  nzTitle: undefined,
} as const;

/**
 * Opens Pouch's dialogs. The editor (Tiptap and the dialogs) loads on first use, outside the app's main bundle.
 * `enabled` is the Pouch feature flag: off, nothing should offer these.
 */
@Injectable({ providedIn: 'root' })
export class PouchLauncher {
  private readonly modal = inject(NzModalService);
  readonly enabled = inject(APP_CONFIG).features.pouch;

  /** Create (no format) or edit a format. Emits the saved format, or undefined when closed without saving. */
  edit(format?: IPouchFormat): Observable<IPouchFormat | undefined> {
    return from(import('./pouch-format-modal/pouch-format-modal.component')).pipe(
      switchMap(({ PouchFormatModalComponent }) =>
        this.modal.create({ ...BIG_MODAL, nzContent: PouchFormatModalComponent, nzData: { format } }).afterClose.asObservable(),
      ),
    );
  }

  /** Fill a format with summaries, preview it (editable) and download it as Word. */
  export(data: PouchExportData): Observable<boolean | undefined> {
    return from(import('./pouch-export-modal/pouch-export-modal.component')).pipe(
      switchMap(({ PouchExportModalComponent }) => this.modal.create({ ...BIG_MODAL, nzContent: PouchExportModalComponent, nzData: data }).afterClose.asObservable()),
    );
  }
}
