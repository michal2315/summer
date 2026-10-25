import { Injectable, inject } from '@angular/core';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { UserService } from '../../core/auth/user.service';
import { ISummary } from '../../shared/models';
import { SummaryService } from '../../shared/services/summary.service';
import { TimelineData, TimelineModalComponent } from './timeline/timeline-modal/timeline-modal.component';

/** Card / table / detail actions, so the confirm + toast behaviour is identical everywhere. */
@Injectable({ providedIn: 'root' })
export class SummaryActionsService {
  private readonly summaries = inject(SummaryService);
  private readonly users = inject(UserService);
  private readonly modal = inject(NzModalService);
  private readonly message = inject(NzMessageService);

  setColor(s: ISummary, color: string) {
    this.summaries.setColor(s, color).subscribe();
  }

  toggleFavorite(s: ISummary) {
    // Optimistic: flip now, roll back if the server refuses.
    this.summaries.patched({ ...s, isFavorite: !s.isFavorite });
    this.users.favoriteSummary(s._id).subscribe({ error: () => this.summaries.patched(s) });
  }

  /** Timeline of the summaries the user selected. */
  openTimeline(summaries: ISummary[]) {
    this.modal.create<TimelineModalComponent, TimelineData>({
      nzTitle: 'ציר זמן',
      nzContent: TimelineModalComponent,
      nzData: { summaries },
      nzFooter: null,
      nzWidth: 'min(1100px, 94vw)',
    });
  }

  toDraft(s: ISummary) {
    this.summaries.toDraft(s).subscribe(() => this.message.success('התמצית הועברה לטיוטות'));
  }

  /** Opens the confirm dialog immediately; resolves true once deleted, false if cancelled. */
  confirmDelete(s: ISummary): Promise<boolean> {
    return new Promise<boolean>((done) => {
      this.modal.confirm({
        nzTitle: 'למחוק את התמצית?',
        nzContent: `"${s.title}" יימחק לצמיתות.`,
        nzOkText: 'מחיקה',
        nzOkDanger: true,
        nzCancelText: 'ביטול',
        nzOnOk: () =>
          new Promise<void>((resolve, reject) =>
            this.summaries.delete(s._id).subscribe({
              next: () => {
                this.message.success('התמצית נמחקה');
                done(true);
                resolve();
              },
              error: reject,
            }),
          ),
        nzOnCancel: () => done(false),
      });
    });
  }
}
