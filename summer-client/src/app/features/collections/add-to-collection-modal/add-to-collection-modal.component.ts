import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { Subject, debounceTime, distinctUntilChanged, startWith, switchMap } from 'rxjs';
import { ICollectionRef } from '../../../shared/models';
import { CollectionService } from '../../../shared/services/collection.service';

export interface AddToCollectionData {
  summaryIds: string[];
}

/** 280px modal: pick collections (server search) and add the selected summaries to them. */
@Component({
  selector: 'app-add-to-collection-modal',
  imports: [FormsModule, NzButtonModule, NzSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './add-to-collection-modal.component.html',
  styleUrl: './add-to-collection-modal.component.scss',
})
export class AddToCollectionModalComponent {
  readonly data = inject<AddToCollectionData>(NZ_MODAL_DATA);
  readonly modal = inject(NzModalRef);
  private readonly collections = inject(CollectionService);
  private readonly message = inject(NzMessageService);

  readonly selected = signal<string[]>([]);
  readonly options = signal<ICollectionRef[]>([]);
  readonly busy = signal(false);
  readonly query$ = new Subject<string>();

  constructor() {
    this.query$
      .pipe(
        startWith(''),
        debounceTime(200),
        distinctUntilChanged(),
        switchMap((t) => this.collections.byName(t)),
      )
      .subscribe((list) => {
        const keep = this.options().filter((o) => this.selected().includes(o._id));
        this.options.set([...keep, ...list.filter((c) => !keep.some((k) => k._id === c._id))]);
      });
  }

  add() {
    this.busy.set(true);
    this.collections.addSummaries(this.selected(), this.data.summaryIds).subscribe({
      next: () => {
        this.message.success('התמציות נוספו ללקט');
        this.modal.close(true);
      },
      error: () => this.busy.set(false),
    });
  }
}
