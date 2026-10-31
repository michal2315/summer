import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { Observable, Subject, concat, debounceTime, distinctUntilChanged, map, startWith, switchMap, toArray } from 'rxjs';
import { IBulkResult, ICollectionRef } from '../../../shared/models';
import { CollectionService } from '../../../shared/services/collection.service';
import { bulkResultMessage } from '../bulk-scope';

export interface BulkCollectionsData {
  /** The selected summaries that may be added (ones you may edit, not sumaroons). */
  addIds: string[];
  /** Why part of the selection can't be added (empty when none is). */
  note: string;
  /** Every selected summary: removing is the collection managers' right, whatever the summary's. */
  removeIds: string[];
  /** Collections the selected summaries are in now (the "remove" options). */
  existing: ICollectionRef[];
}

/** Add the selected summaries to collections and/or take them out of others. Closes with true after a change. */
@Component({
  selector: 'app-bulk-collections-modal',
  imports: [FormsModule, NzButtonModule, NzSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './bulk-collections-modal.component.html',
  styleUrl: './bulk-collections-modal.component.scss',
})
export class BulkCollectionsModalComponent {
  readonly data = inject<BulkCollectionsData>(NZ_MODAL_DATA);
  readonly modal = inject(NzModalRef);
  private readonly collections = inject(CollectionService);
  private readonly message = inject(NzMessageService);

  readonly add = signal<string[]>([]);
  readonly remove = signal<string[]>([]);
  readonly options = signal<ICollectionRef[]>([]);
  readonly busy = signal(false);
  readonly query$ = new Subject<string>();
  /** A collection can't be added to and removed from at once. */
  readonly removeOptions = computed(() => this.data.existing.filter((c) => !this.add().includes(c._id)));
  readonly canApply = computed(() => this.add().length > 0 || this.remove().length > 0);

  constructor() {
    this.query$
      .pipe(
        startWith(''),
        debounceTime(200),
        distinctUntilChanged(),
        switchMap((t) => this.collections.byName(t)),
      )
      .subscribe((list) => {
        const keep = this.options().filter((o) => this.add().includes(o._id));
        this.options.set([...keep, ...list.filter((c) => !keep.some((k) => k._id === c._id))]);
      });
  }

  setAdd(ids: string[]) {
    this.add.set(ids);
    this.remove.update((r) => r.filter((id) => !ids.includes(id)));
  }

  apply() {
    // Partial: whatever can't be added/removed is skipped and reported, not fatal.
    const steps: Observable<IBulkResult & { done: string }>[] = [];
    if (this.add().length) steps.push(this.collections.addSummaries(this.add(), this.data.addIds, true).pipe(map((r) => ({ ...r, done: 'תמציות נוספו' }))));
    if (this.remove().length)
      steps.push(this.collections.removeSummaries(this.remove(), this.data.removeIds).pipe(map((r) => ({ ...r, done: 'לקטים עודכנו בהסרה' }))));
    this.busy.set(true);
    concat(...steps)
      .pipe(toArray())
      .subscribe({
        next: (results) => {
          const text = results.map((r) => bulkResultMessage(r, r.done)).join(' · ');
          if (results.some((r) => r.skipped.length)) this.message.warning(text);
          else this.message.success(text);
          this.modal.close(true);
        },
        error: () => this.busy.set(false),
      });
  }
}
