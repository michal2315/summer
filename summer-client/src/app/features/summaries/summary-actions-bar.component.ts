import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzDropDownModule } from 'ng-zorro-antd/dropdown';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { ICollection, IContentType, SummaryKind } from '../../shared/models';
import { ContentTypeService } from '../../shared/services/content-type.service';
import { CollectionService } from '../../shared/services/collection.service';
import { SummaryService } from '../../shared/services/summary.service';
import { AddToCollectionData, AddToCollectionModalComponent } from '../collections/add-to-collection-modal.component';
import { targetsFor } from './excel/excel-fields';
import { UploadExcelData, UploadExcelWizardComponent } from './excel/upload-excel-wizard.component';
import { SummaryListStore } from './summary-list.store';

/**
 * Toolbar over a summaries list (spec "export-buttons-row"): enter selection mode, then act on the selection —
 * add to collection, Excel export, remove from the current collection. Feed also gets Excel template/upload.
 */
@Component({
  selector: 'app-summary-actions-bar',
  imports: [NzButtonModule, NzDropDownModule, NzIconModule, NzToolTipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!store.selectMode()) {
      <button nz-button nzSize="small" type="button" (click)="store.setSelectMode(true)"><span nz-icon nzType="check-square"></span> בחירה</button>
      @if (excelActions()) {
        <button nz-button nzSize="small" type="button" nz-dropdown [nzDropdownMenu]="templates" nzTrigger="click">
          <span nz-icon nzType="download"></span> תבנית Excel <span nz-icon nzType="down"></span>
        </button>
        <nz-dropdown-menu #templates="nzDropdownMenu">
          <ul nz-menu>
            @for (t of contentTypes.list(); track t._id) {
              <li nz-menu-item (click)="downloadTemplate(t)">{{ t.displayName }}</li>
            }
          </ul>
        </nz-dropdown-menu>
        <button nz-button nzSize="small" type="button" (click)="openUpload()"><span nz-icon nzType="upload"></span> העלאת Excel</button>
      }
    } @else {
      <span class="count" [class.capped]="store.selectedCount() >= store.maxSelection">נבחרו: {{ store.selectedCount() }}</span>
      <button nz-button nzSize="small" nzType="link" type="button" (click)="store.toggleSelectAllLoaded()">בחירת כל המוצגים</button>
      <button nz-button nzSize="small" type="button" [disabled]="!store.selectedCount()" (click)="addToCollection()"><span nz-icon nzType="folder-add"></span> הוספה לאוסף</button>
      <button nz-button nzSize="small" type="button" [disabled]="!store.selectedCount()" [nzLoading]="exporting()" (click)="export(false)"><span nz-icon nzType="file-excel"></span> ייצוא הנבחרים</button>
      <button nz-button nzSize="small" type="button" [nzLoading]="exporting()" (click)="export(true)" nz-tooltip="כל תוצאות החיפוש הנוכחי">ייצוא הכל</button>
      @if (collection(); as c) {
        <button nz-button nzSize="small" nzDanger type="button" [disabled]="!store.selectedCount()" (click)="removeFromCollection(c)"><span nz-icon nzType="minus-circle"></span> הסרה מהאוסף</button>
      }
      <button nz-button nzSize="small" nzType="text" type="button" (click)="store.setSelectMode(false)">ביטול</button>
    }
  `,
  styles: `
    :host { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .count { font-weight: 700; font-size: 13px; }
    .count.capped { color: #e74d3d; }
  `,
})
export class SummaryActionsBarComponent {
  readonly store = inject(SummaryListStore);
  readonly contentTypes = inject(ContentTypeService);
  private readonly summaries = inject(SummaryService);
  private readonly collections = inject(CollectionService);
  private readonly modal = inject(NzModalService);
  private readonly message = inject(NzMessageService);

  /** Show Excel template download + upload (feed only). */
  readonly excelActions = input(false);
  /** When listing a collection: enables "remove from collection". */
  readonly collection = input<ICollection | null>(null);

  readonly exporting = signal(false);

  downloadTemplate(t: IContentType) {
    const fieldNames = targetsFor(t, this.contentTypes.fieldsById()).map((f) => f.label);
    this.summaries.downloadTemplate(fieldNames, `תבנית-${t.displayName}.xlsx`).subscribe();
  }

  openUpload() {
    this.modal
      .create<UploadExcelWizardComponent, UploadExcelData, boolean>({
        nzTitle: 'ייבוא סיכומים מ-Excel',
        nzContent: UploadExcelWizardComponent,
        nzData: {},
        nzFooter: null,
        nzWidth: 760,
        nzMaskClosable: false,
      })
      .afterClose.subscribe((imported) => imported && this.store.reload());
  }

  addToCollection() {
    // A sumaroon lives only inside its running summary.
    const sumaroons = new Set(this.store.summaries().filter((s) => s.kind === SummaryKind.Sumaroon).map((s) => s._id));
    const summaryIds = [...this.store.selected()].filter((id) => !sumaroons.has(id));
    const skipped = this.store.selectedCount() - summaryIds.length;
    if (!summaryIds.length) {
      this.message.warning('תמציתוניות לא נוספות לאוספים — הן שייכות לתמצית הרצף שלהן');
      return;
    }
    if (skipped) this.message.info(`${skipped} תמציתוניות דולגו — הן שייכות לתמצית הרצף שלהן`);
    this.modal
      .create<AddToCollectionModalComponent, AddToCollectionData, boolean>({
        nzTitle: 'הוספה לאוסף',
        nzContent: AddToCollectionModalComponent,
        nzData: { summaryIds },
        nzFooter: null,
        nzWidth: 280,
      })
      .afterClose.subscribe((added) => added && this.store.setSelectMode(false));
  }

  export(all: boolean) {
    const query = this.store.currentQuery();
    this.exporting.set(true);
    this.summaries.exportExcel({ summariesId: all ? [] : [...this.store.selected()], all, search: all ? query?.search : undefined }).subscribe({
      complete: () => this.exporting.set(false),
      error: () => this.exporting.set(false),
    });
  }

  removeFromCollection(c: ICollection) {
    const ids = [...this.store.selected()];
    this.modal.confirm({
      nzTitle: `להסיר ${ids.length} סיכומים מהאוסף "${c.name}"?`,
      nzContent: 'הסיכומים עצמם לא יימחקו.',
      nzOkText: 'הסרה',
      nzOkDanger: true,
      nzCancelText: 'ביטול',
      nzOnOk: () =>
        new Promise<void>((resolve, reject) =>
          this.collections
            .edit(c._id, { name: c.name, permissions: c.permissions.map((p) => p._id), managers: c.managers, summaries: ids })
            .subscribe({
              next: () => {
                this.message.success('הסיכומים הוסרו מהאוסף');
                this.store.setSelectMode(false);
                this.store.reload();
                resolve();
              },
              error: reject,
            }),
        ),
    });
  }
}
