import { AltKeyDirective } from '../../../shared/keyboard/alt-key.directive';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzDropDownModule } from 'ng-zorro-antd/dropdown';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzPopoverModule } from 'ng-zorro-antd/popover';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { UserService } from '../../../core/auth/user.service';
import { SUMMARY_COLORS } from '../../../shared/models/colors';
import { IBulkResult, ICollection, ICollectionRef, IContentType } from '../../../shared/models';
import { ContentTypeService } from '../../../shared/services/content-type.service';
import { CollectionService } from '../../../shared/services/collection.service';
import { SummaryService } from '../../../shared/services/summary.service';
import { BulkCollectionsData, BulkCollectionsModalComponent } from '../bulk-collections-modal/bulk-collections-modal.component';
import { BulkFolderData, BulkFolderModalComponent } from '../bulk-folder-modal/bulk-folder-modal.component';
import { BulkLabelsData, BulkLabelsModalComponent } from '../bulk-labels-modal/bulk-labels-modal.component';
import { BulkScope, bulkResultMessage, bulkScope, scopeNote } from '../bulk-scope';
import { targetsFor } from '../excel/excel-fields';
import { UploadExcelData, UploadExcelWizardComponent } from '../excel/upload-excel-wizard/upload-excel-wizard.component';
import { SummaryActionsService } from '../summary-actions.service';
import { ExportWordData, ExportWordModalComponent } from '../word/export-word-modal/export-word-modal.component';
import { SummaryListStore } from '../summary-list.store';

/**
 * Toolbar over a summaries list (spec "export-buttons-row"). Outside selection mode: "select" plus one Excel menu
 * (export all results; on the feed also upload and templates). In selection mode: a selection chip, the bulk actions
 * (collections, folder, labels, colour, timeline, export menu, and favourites / to-draft / delete behind ⋯), then
 * remove-from-collection and exit. Each applies to the part of the selection it may (edits: summaries you may edit;
 * to-draft and delete: your own) and reports the rest. After a bulk change the list reloads and selection mode ends.
 */
@Component({
  selector: 'app-summary-actions-bar',
  imports: [AltKeyDirective, NzButtonModule, NzCheckboxModule, NzDropDownModule, NzIconModule, NzPopoverModule, NzToolTipModule],
  host: { '[class.selecting]': 'store.selectMode()' },
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
  private readonly users = inject(UserService);
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

  readonly colors = SUMMARY_COLORS;
  readonly colorOpen = signal(false);

  /**
   * What each bulk edit applies to: only summaries the user may edit; a sumaroon also never joins a collection or a
   * folder, and a draft never sits in a folder. To-draft and delete touch only your own summaries.
   */
  readonly collectionScope = computed(() => bulkScope(this.store.selectedRows(), { sumaroons: false }));
  readonly folderScope = computed(() => bulkScope(this.store.selectedRows(), { sumaroons: false, drafts: false }));
  readonly labelsScope = computed(() => bulkScope(this.store.selectedRows()));
  readonly mineIds = computed(() => this.store.selectedRows().filter((r) => r.summary?.user?._id === this.users.userId()).map((r) => r.id));
  readonly draftIds = computed(() => this.store.selectedRows().filter((r) => r.summary?.user?._id === this.users.userId() && !r.summary.isDraft).map((r) => r.id));

  editCollections() {
    const scope = this.collectionScope();
    const existing = new Map<string, ICollectionRef>();
    for (const r of this.store.selectedRows()) for (const c of r.summary?.collectionIds ?? []) existing.set(c._id, c);
    this.modal
      .create<BulkCollectionsModalComponent, BulkCollectionsData, boolean>({
        nzTitle: 'לקטים לתמציות הנבחרות',
        nzContent: BulkCollectionsModalComponent,
        nzData: {
          addIds: scope.ids,
          note: scopeNote(scope),
          removeIds: [...this.store.selected()],
          existing: [...existing.values()].sort((a, b) => a.name.localeCompare(b.name, 'he')),
        },
        nzFooter: null,
        nzWidth: 400,
      })
      .afterClose.subscribe((changed) => changed && this.done());
  }

  moveToFolder() {
    const scope = this.folderScope();
    if (!scope.ids.length) return;
    this.modal
      .create<BulkFolderModalComponent, BulkFolderData, boolean>({
        nzTitle: 'העברה לתיקייה',
        nzContent: BulkFolderModalComponent,
        nzData: { summaryIds: scope.ids, note: scopeNote(scope) },
        nzFooter: null,
        nzWidth: 400,
      })
      .afterClose.subscribe((changed) => changed && this.done());
  }

  setColor(color: string) {
    this.colorOpen.set(false);
    this.summaries.bulkColor([...this.store.selected()], color).subscribe((r) => this.done(r, 'תמציות עודכנו'));
  }

  setFavorite(favorite: boolean) {
    this.users.bulkFavorite([...this.store.selected()], favorite).subscribe((r) => this.done(r, favorite ? 'תמציות נוספו למועדפים' : 'תמציות הוסרו מהמועדפים'));
  }

  toDraft() {
    const ids = this.draftIds();
    this.confirm({
      title: `להפוך ${ids.length} תמציות לטיוטות?`,
      content: this.onlyMineNote(ids.length, 'טיוטות לא מוצגות לאחרים עד שמפרסמים אותן שוב.'),
      ok: 'הפיכה לטיוטה',
      call: () => this.summaries.bulkToDraft(ids),
      done: 'תמציות הועברו לטיוטות',
    });
  }

  deleteMine() {
    const ids = this.mineIds();
    this.confirm({
      title: `למחוק ${ids.length} תמציות?`,
      content: this.onlyMineNote(ids.length, 'התמציות יימחקו לצמיתות; תמצית רצף נמחקת יחד עם התמציתוניות שלה.'),
      ok: 'מחיקה',
      danger: true,
      call: () => this.summaries.bulkDelete(ids),
      done: 'תמציות נמחקו',
    });
  }

  /** "Only yours" spelled out when the selection holds summaries of others. */
  private onlyMineNote(n: number, text: string): string {
    const others = this.store.selectedCount() - n;
    return others > 0 ? `${text} רק תמציות שכתבתם — ${others} אחרות לא ישתנו.` : text;
  }

  private confirm(o: { title: string; content: string; ok: string; danger?: boolean; call: () => Observable<IBulkResult>; done: string }) {
    this.modal.confirm({
      nzTitle: o.title,
      nzContent: o.content,
      nzOkText: o.ok,
      nzOkDanger: !!o.danger,
      nzCancelText: 'ביטול',
      nzOnOk: () => new Promise<void>((resolve, reject) => o.call().subscribe({ next: (r) => (this.done(r, o.done), resolve()), error: reject })),
    });
  }

  /** After a bulk change: report it (when the result is ours to report), leave selection mode, reload the list. */
  private done(result?: IBulkResult, text = '') {
    if (result) {
      const msg = bulkResultMessage(result, text);
      if (result.skipped.length) this.message.warning(msg);
      else this.message.success(msg);
    }
    this.store.setSelectMode(false);
    this.store.reload();
  }

  editLabels() {
    const scope = this.labelsScope();
    if (!scope.ids.length) return;
    const ids = new Set(scope.ids);
    const existing = [...new Set(this.store.selectedRows().flatMap((r) => (ids.has(r.id) ? (r.summary?.labels.map((l) => l.name) ?? []) : [])))];
    this.modal
      .create<BulkLabelsModalComponent, BulkLabelsData, boolean>({
        nzTitle: 'תגיות לתמציות הנבחרות',
        nzContent: BulkLabelsModalComponent,
        nzData: { summaryIds: scope.ids, note: scopeNote(scope), existing: existing.sort((a, b) => a.localeCompare(b, 'he')) },
        nzFooter: null,
        nzWidth: 400,
      })
      .afterClose.subscribe((changed) => changed && this.done());
  }

  /** Tooltip on a bulk edit button: its name, plus why part (or all) of the selection is left out. */
  tip(name: string, scope: BulkScope): string {
    if (!this.store.selectedCount()) return name;
    const note = scope.ids.length ? scopeNote(scope) : 'אין בבחירה תמציות שאפשר לערוך';
    return note ? `${name} · ${note}` : name;
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
          this.collections.removeSummaries([c._id], ids).subscribe({
            next: (r) => {
              if (r.skipped.length) this.message.warning('רק מנהלי הלקט יכולים להסיר ממנו תמציות');
              else this.message.success('התמציות הוסרו מהלקט');
              this.done();
              resolve();
            },
            error: reject,
          }),
        ),
    });
  }
}
