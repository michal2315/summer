import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { Subject, debounceTime, distinctUntilChanged, startWith, switchMap } from 'rxjs';
import { LabelService } from '../../../shared/services/label.service';
import { SummaryService } from '../../../shared/services/summary.service';
import { bulkResultMessage } from '../bulk-scope';

export interface BulkLabelsData {
  /** The selected summaries the user may edit. */
  summaryIds: string[];
  /** Why part of the selection is left out (empty when none is). */
  note: string;
  /** Labels already on those summaries (the "remove" options). */
  existing: string[];
}

/** Add and/or remove labels on the selected summaries the user may edit. Closes with true after a change. */
@Component({
  selector: 'app-bulk-labels-modal',
  imports: [FormsModule, NzButtonModule, NzSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './bulk-labels-modal.component.html',
  styleUrl: './bulk-labels-modal.component.scss',
})
export class BulkLabelsModalComponent {
  readonly data = inject<BulkLabelsData>(NZ_MODAL_DATA);
  readonly modal = inject(NzModalRef);
  private readonly labels = inject(LabelService);
  private readonly summaries = inject(SummaryService);
  private readonly message = inject(NzMessageService);

  readonly add = signal<string[]>([]);
  readonly remove = signal<string[]>([]);
  readonly options = signal<string[]>([]);
  readonly busy = signal(false);
  readonly query$ = new Subject<string>();
  /** A label can't be added and removed at once. */
  readonly removeOptions = computed(() => this.data.existing.filter((l) => !this.add().includes(l)));
  readonly canApply = computed(() => this.add().length > 0 || this.remove().length > 0);

  constructor() {
    this.query$
      .pipe(
        startWith(''),
        debounceTime(200),
        distinctUntilChanged(),
        switchMap((t) => this.labels.search(t)),
      )
      .subscribe((list) => this.options.set(list));
  }

  setAdd(labels: string[]) {
    this.add.set(labels);
    this.remove.update((r) => r.filter((l) => !labels.includes(l)));
  }

  apply() {
    this.busy.set(true);
    this.summaries.bulkLabels(this.data.summaryIds, this.add(), this.remove()).subscribe({
      next: (result) => {
        const text = bulkResultMessage(result, 'תמציות עודכנו');
        if (result.skipped.length) this.message.warning(text);
        else this.message.success(text);
        this.modal.close(true);
      },
      error: () => this.busy.set(false),
    });
  }
}
