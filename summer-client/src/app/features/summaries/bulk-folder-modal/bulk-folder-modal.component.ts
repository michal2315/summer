import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { UserService } from '../../../core/auth/user.service';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { FolderService, managedFolderPaths } from '../../../shared/services/folder.service';
import { bulkResultMessage } from '../bulk-scope';

export interface BulkFolderData {
  /** The selected summaries that may be placed (yours to edit, not drafts or sumaroons). */
  summaryIds: string[];
  /** Why part of the selection is left out (empty when none is). */
  note: string;
}

/** Add the selected summaries to one of the folders you manage (they keep their other folders). Closes with true after a change. */
@Component({
  selector: 'app-bulk-folder-modal',
  imports: [FormsModule, NzButtonModule, NzSelectModule, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './bulk-folder-modal.component.html',
  styleUrl: './bulk-folder-modal.component.scss',
})
export class BulkFolderModalComponent {
  readonly data = inject<BulkFolderData>(NZ_MODAL_DATA);
  readonly modal = inject(NzModalRef);
  private readonly folders = inject(FolderService);
  private readonly users = inject(UserService);
  private readonly message = inject(NzMessageService);

  readonly folder = signal<string | null>(null);
  readonly options = signal<{ _id: string; path: string }[] | null>(null);
  readonly busy = signal(false);

  constructor() {
    this.folders.tree().subscribe({
      next: (list) => this.options.set(managedFolderPaths(list, this.users.userId() ?? '')),
      error: () => this.options.set([]),
    });
  }

  add() {
    const folderId = this.folder();
    if (!folderId) return;
    this.busy.set(true);
    this.folders
      .addItems(folderId, this.data.summaryIds, true)
      .subscribe({
        next: (result) => {
          const text = bulkResultMessage(result, 'תמציות נוספו לתיקייה');
          if (result.skipped.length) this.message.warning(text);
          else this.message.success(text);
          this.modal.close(true);
        },
        error: () => this.busy.set(false),
      });
  }
}
