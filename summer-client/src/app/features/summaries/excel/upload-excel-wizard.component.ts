import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzStepsModule } from 'ng-zorro-antd/steps';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzUploadFile, NzUploadModule } from 'ng-zorro-antd/upload';
import { ICollectionRef } from '../../../shared/models';
import { CatalogService } from '../../../shared/services/catalog.service';
import { SummaryService } from '../../../shared/services/summary.service';
import { ImportTarget, SheetData, guessMapping, readSheet, targetsFor } from './excel-fields';

export interface UploadExcelData {
  /** preselected content type id */
  contentTypeId?: string;
}

const PREVIEW_ROWS = 5;

/** Excel import (spec §10.12): 1. file + scope → 2. column→field mapping → 3. preview & import. */
@Component({
  selector: 'app-upload-excel-wizard',
  imports: [FormsModule, NzAlertModule, NzButtonModule, NzIconModule, NzSelectModule, NzSpinModule, NzStepsModule, NzTableModule, NzUploadModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './upload-excel-wizard.component.html',
  styleUrl: './upload-excel-wizard.component.scss',
})
export class UploadExcelWizardComponent {
  readonly catalog = inject(CatalogService);
  private readonly summaries = inject(SummaryService);
  private readonly modal = inject(NzModalRef);
  private readonly message = inject(NzMessageService);
  private readonly data = inject<UploadExcelData>(NZ_MODAL_DATA, { optional: true });

  readonly step = signal(0);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  // step 1
  readonly contentTypeId = signal<string | null>(this.data?.contentTypeId ?? null);
  readonly permissions = signal<string[]>([]);
  readonly collections = signal<string[]>([]);
  readonly collectionOptions = signal<ICollectionRef[]>([]);
  readonly file = signal<File | null>(null);
  readonly fileList = computed<NzUploadFile[]>(() => {
    const f = this.file();
    return f ? [{ uid: f.name, name: f.name, status: 'done' }] : [];
  });
  private sheet: SheetData = { headers: [], rows: [] };

  // step 2
  readonly headers = signal<string[]>([]);
  readonly targets = computed<ImportTarget[]>(() =>
    targetsFor(
      this.catalog.contentTypes().find((t) => t._id === this.contentTypeId()),
      this.catalog.fieldsById(),
    ),
  );
  /** target key → Excel header */
  readonly mapping = signal<Record<string, string | null>>({});
  readonly missingRequired = computed(() => this.targets().filter((t) => t.required && !this.mapping()[t.key]));

  // step 3
  readonly mappedTargets = computed(() => this.targets().filter((t) => this.mapping()[t.key]));
  readonly preview = computed(() => {
    this.mapping();
    return this.sheet.rows.slice(0, PREVIEW_ROWS);
  });
  readonly rowCount = signal(0);

  readonly canNext = computed(() => {
    switch (this.step()) {
      case 0:
        return !!this.contentTypeId() && this.permissions().length > 0 && !!this.file();
      case 1:
        return this.missingRequired().length === 0;
      default:
        return true;
    }
  });

  constructor() {
    this.searchCollections('');
  }

  beforeUpload = (f: NzUploadFile): boolean => {
    this.file.set(f as unknown as File);
    this.error.set(null);
    return false;
  };

  searchCollections(text: string) {
    this.catalog.collectionsByName(text).subscribe((list) => this.collectionOptions.set(list));
  }

  setMapping(key: string, header: string | null) {
    this.mapping.update((m) => ({ ...m, [key]: header }));
  }

  cell(row: Record<string, unknown>, target: ImportTarget): string {
    const header = this.mapping()[target.key];
    const v = header ? row[header] : '';
    return v instanceof Date ? v.toLocaleDateString('he-IL') : String(v ?? '');
  }

  async next() {
    if (!this.canNext()) return;
    if (this.step() === 0) {
      this.busy.set(true);
      try {
        this.sheet = await readSheet(this.file()!);
      } catch {
        this.error.set('לא ניתן לקרוא את הקובץ. ודאו שזהו קובץ Excel תקין.');
        this.busy.set(false);
        return;
      }
      this.busy.set(false);
      if (!this.sheet.rows.length) {
        this.error.set('הקובץ ריק — לא נמצאו שורות לייבוא.');
        return;
      }
      this.headers.set(this.sheet.headers);
      this.rowCount.set(this.sheet.rows.length);
      this.mapping.set(guessMapping(this.sheet.headers, this.targets()));
    }
    this.step.update((s) => s + 1);
  }

  back() {
    this.step.update((s) => Math.max(0, s - 1));
  }

  import() {
    // Server contract: headersMap is Excel header → field key.
    const headersMap = Object.fromEntries(
      Object.entries(this.mapping())
        .filter(([, header]) => !!header)
        .map(([key, header]) => [header!, key]),
    );
    this.busy.set(true);
    this.summaries
      .uploadExcel({ file: this.file()!, type: this.contentTypeId()!, collections: this.collections(), permissions: this.permissions(), headersMap })
      .subscribe({
        next: (res) => {
          this.message.success(`יובאו ${res?.created ?? this.rowCount()} סיכומים`);
          this.modal.close(true);
        },
        error: () => this.busy.set(false),
      });
  }

  cancel() {
    this.modal.close(false);
  }
}
