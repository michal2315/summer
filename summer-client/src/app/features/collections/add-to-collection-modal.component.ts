import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { Subject, debounceTime, distinctUntilChanged, startWith, switchMap } from 'rxjs';
import { ICollectionRef } from '../../shared/models';
import { CatalogService } from '../../shared/services/catalog.service';
import { CollectionService } from '../../shared/services/collection.service';

export interface AddToCollectionData {
  summaryIds: string[];
}

/** 280px modal: pick collections (server search) and add the selected summaries to them. */
@Component({
  selector: 'app-add-to-collection-modal',
  imports: [FormsModule, NzButtonModule, NzSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="muted">{{ data.summaryIds.length }} סיכומים נבחרו</p>
    <nz-select
      nzMode="multiple"
      nzShowSearch
      nzServerSearch
      nzPlaceHolder="חיפוש אוסף"
      [ngModel]="selected()"
      (ngModelChange)="selected.set($event)"
      (nzOnSearch)="query$.next($event)"
      aria-label="אוספים"
    >
      @for (c of options(); track c._id) {
        <nz-option [nzValue]="c._id" [nzLabel]="c.name" />
      }
    </nz-select>
    <footer>
      <button nz-button type="button" (click)="modal.close(false)">ביטול</button>
      <button nz-button nzType="primary" type="button" [disabled]="!selected().length" [nzLoading]="busy()" (click)="add()">הוספה</button>
    </footer>
  `,
  styles: `
    nz-select { width: 100%; }
    p { margin: 0 0 8px; }
    footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
  `,
})
export class AddToCollectionModalComponent {
  readonly data = inject<AddToCollectionData>(NZ_MODAL_DATA);
  readonly modal = inject(NzModalRef);
  private readonly catalog = inject(CatalogService);
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
        switchMap((t) => this.catalog.collectionsByName(t)),
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
        this.message.success('הסיכומים נוספו לאוסף');
        this.modal.close(true);
      },
      error: () => this.busy.set(false),
    });
  }
}
