import { AltKeyDirective } from '../../../shared/keyboard/alt-key.directive';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzDropDownModule } from 'ng-zorro-antd/dropdown';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { ICollection, IContentType, SummaryKind } from '../../../shared/models';
import { ContentTypeService } from '../../../shared/services/content-type.service';
import { CollectionService } from '../../../shared/services/collection.service';
import { SummaryService } from '../../../shared/services/summary.service';
import { AddToCollectionData, AddToCollectionModalComponent } from '../../collections/add-to-collection-modal/add-to-collection-modal.component';
import { targetsFor } from '../excel/excel-fields';
import { UploadExcelData, UploadExcelWizardComponent } from '../excel/upload-excel-wizard/upload-excel-wizard.component';
import { SummaryActionsService } from '../summary-actions.service';
import { ExportWordData, ExportWordModalComponent } from '../word/export-word-modal/export-word-modal.component';
import { SummaryListStore } from '../summary-list.store';

/**
 * Toolbar over a summaries list (spec "export-buttons-row"): enter selection mode, then act on the selection —
 * add to collection, Excel/Word export, remove from the current collection. Feed also gets Excel template/upload.
 */
@Component({
  selector: 'app-summary-actions-bar',
  imports: [AltKeyDirective, NzButtonModule, NzDropDownModule, NzIconModule, NzToolTipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './summary-actions-bar.component.html',
  styleUrl: './summary-actions-bar.component.scss',
})
export class SummaryActionsBarComponent {
  readonly store = inject(SummaryListStore);
  readonly contentTypes = inject(ContentTypeService);
  private readonly actions = inject(SummaryActionsService);
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
        nzTitle: 'ייבוא תמציות מ-Excel',
        nzContent: UploadExcelWizardComponent,
        nzData: {},
        nzFooter: null,
        nzWidth: 760,
        nzMaskClosable: false,
      })
      .afterClose.subscribe((imported) => imported && this.store.reload());
  }

  /** Timeline of exactly the selected summaries. */
  timeline() {
    const selected = this.store.selected();
    this.actions.openTimeline(this.store.summaries().filter((s) => selected.has(s._id)));
  }

  addToCollection() {
    // A sumaroon lives only inside its running summary.
    const sumaroons = new Set(this.store.summaries().filter((s) => s.kind === SummaryKind.Sumaroon).map((s) => s._id));
    const summaryIds = [...this.store.selected()].filter((id) => !sumaroons.has(id));
    const skipped = this.store.selectedCount() - summaryIds.length;
    if (!summaryIds.length) {
      this.message.warning('תמציתוניות לא נוספות ללקטים — הן שייכות לתמצית הרצף שלהן');
      return;
    }
    if (skipped) this.message.info(`${skipped} תמציתוניות דולגו — הן שייכות לתמצית הרצף שלהן`);
    this.modal
      .create<AddToCollectionModalComponent, AddToCollectionData, boolean>({
        nzTitle: 'הוספה ללקט',
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

  exportWord() {
    this.modal.create<ExportWordModalComponent, ExportWordData, boolean>({
      nzTitle: 'ייצוא ל-Word',
      nzContent: ExportWordModalComponent,
      nzData: { selectedIds: [...this.store.selected()], search: this.store.currentQuery()?.search },
      nzFooter: null,
      nzWidth: 560,
    });
  }

  removeFromCollection(c: ICollection) {
    const ids = [...this.store.selected()];
    this.modal.confirm({
      nzTitle: `להסיר ${ids.length} תמציות מהלקט "${c.name}"?`,
      nzContent: 'התמציות עצמן לא יימחקו.',
      nzOkText: 'הסרה',
      nzOkDanger: true,
      nzCancelText: 'ביטול',
      nzOnOk: () =>
        new Promise<void>((resolve, reject) =>
          this.collections
            .edit(c._id, { name: c.name, permissions: c.permissions.map((p) => p._id), managers: c.managers, summaries: ids })
            .subscribe({
              next: () => {
                this.message.success('התמציות הוסרו מהלקט');
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
