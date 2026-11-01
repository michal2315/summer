import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { Subject, debounceTime, distinctUntilChanged, map, startWith, switchMap } from 'rxjs';
import { UserService } from '../../../core/auth/user.service';
import { SearchType, SummaryKind } from '../../../shared/models';
import { FolderService } from '../../../shared/services/folder.service';
import { SummaryService } from '../../../shared/services/summary.service';

export interface AddToFolderData {
  folderId: string;
  folderName: string;
}

interface Option {
  _id: string;
  name: string;
}

/** Pick summaries (server search by title) and move them into a folder. */
@Component({
  selector: 'app-add-to-folder-modal',
  imports: [FormsModule, NzButtonModule, NzSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './add-to-folder-modal.component.html',
  styleUrl: './add-to-folder-modal.component.scss',
})
export class AddToFolderModalComponent {
  readonly data = inject<AddToFolderData>(NZ_MODAL_DATA);
  readonly modal = inject(NzModalRef);
  private readonly summaryService = inject(SummaryService);
  private readonly users = inject(UserService);
  private readonly folders = inject(FolderService);
  private readonly message = inject(NzMessageService);

  readonly summaries = signal<string[]>([]);
  readonly summaryOptions = signal<Option[]>([]);
  readonly busy = signal(false);
  readonly summaryQuery$ = new Subject<string>();

  constructor() {
    this.summaryQuery$
      .pipe(
        startWith(''),
        debounceTime(200),
        distinctUntilChanged(),
        switchMap((t) => this.summaryService.search(this.users.userId()!, { text: t || undefined, searchTypes: [SearchType.Title], kinds: [SummaryKind.Summary, SummaryKind.Running], limit: 20 })),
        map((res) => res.summaries.map((s) => ({ _id: s._id, name: s.title }))),
      )
      .subscribe((list) => this.merge(list));
  }

  /** Keep already-selected options visible while the search results change. */
  private merge(list: Option[]) {
    const keep = this.summaryOptions().filter((o) => this.summaries().includes(o._id));
    this.summaryOptions.set([...keep, ...list.filter((o) => !keep.some((k) => k._id === o._id))]);
  }

  add() {
    this.busy.set(true);
    this.folders.addItems(this.data.folderId, this.summaries()).subscribe({
      next: () => {
        this.message.success('התמציות נוספו לתיקייה');
        this.modal.close(true);
      },
      error: () => this.busy.set(false),
    });
  }
}
