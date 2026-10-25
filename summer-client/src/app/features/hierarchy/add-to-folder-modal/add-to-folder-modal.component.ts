import { ChangeDetectionStrategy, Component, WritableSignal, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { Subject, debounceTime, distinctUntilChanged, map, startWith, switchMap } from 'rxjs';
import { UserService } from '../../../core/auth/user.service';
import { SearchType, SummaryKind } from '../../../shared/models';
import { CollectionService } from '../../../shared/services/collection.service';
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

/** Pick collections and summaries (server search) and move them into a folder. */
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
  private readonly collectionService = inject(CollectionService);
  private readonly summaryService = inject(SummaryService);
  private readonly users = inject(UserService);
  private readonly folders = inject(FolderService);
  private readonly message = inject(NzMessageService);

  readonly collections = signal<string[]>([]);
  readonly summaries = signal<string[]>([]);
  readonly collectionOptions = signal<Option[]>([]);
  readonly summaryOptions = signal<Option[]>([]);
  readonly busy = signal(false);
  readonly collectionQuery$ = new Subject<string>();
  readonly summaryQuery$ = new Subject<string>();

  constructor() {
    this.collectionQuery$
      .pipe(
        startWith(''),
        debounceTime(200),
        distinctUntilChanged(),
        switchMap((t) => this.collectionService.byName(t)),
      )
      .subscribe((list) => this.merge(this.collectionOptions, this.collections(), list));

    this.summaryQuery$
      .pipe(
        startWith(''),
        debounceTime(200),
        distinctUntilChanged(),
        switchMap((t) => this.summaryService.search(this.users.userId()!, { text: t || undefined, searchTypes: [SearchType.Title], kinds: [SummaryKind.Summary, SummaryKind.Running], limit: 20 })),
        map((res) => res.summaries.map((s) => ({ _id: s._id, name: s.title }))),
      )
      .subscribe((list) => this.merge(this.summaryOptions, this.summaries(), list));
  }

  /** Keep already-selected options visible while the search results change. */
  private merge(options: WritableSignal<Option[]>, selected: string[], list: Option[]) {
    const keep = options().filter((o) => selected.includes(o._id));
    options.set([...keep, ...list.filter((o) => !keep.some((k) => k._id === o._id))]);
  }

  add() {
    const items = [
      ...this.collections().map((_id) => ({ type: 'collection' as const, _id })),
      ...this.summaries().map((_id) => ({ type: 'summary' as const, _id })),
    ];
    this.busy.set(true);
    this.folders.addItems(this.data.folderId, items).subscribe({
      next: () => {
        this.message.success('הפריטים נוספו לתיקייה');
        this.modal.close(true);
      },
      error: () => this.busy.set(false),
    });
  }
}
