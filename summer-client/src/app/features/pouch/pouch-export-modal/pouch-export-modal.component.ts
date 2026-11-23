import { ChangeDetectionStrategy, Component, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { getSchema } from '@tiptap/core';
import { DOMParser as PmDOMParser } from '@tiptap/pm/model';
import { format as formatDate } from 'date-fns';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { IPouchFormat, IPouchPage, ISummarySearch, PouchDoc } from '../../../shared/models';
import { ContentTypeService } from '../../../shared/services/content-type.service';
import { PouchService } from '../../../shared/services/pouch.service';
import { PouchEditorComponent } from '../editor/pouch-editor/pouch-editor.component';
import { pouchExtensions } from '../editor/pouch-extensions';
import { fieldLabel } from '../pouch-fields';
import { fillDoc } from '../pouch-fill';
import { quillToHtml } from '../quill-html';

export interface PouchExportData {
  format: IPouchFormat;
  /** The selection; empty → every result of `search`. */
  selectedIds: string[];
  search?: ISummarySearch;
}

/** Images on other pages are fetched and inlined before the Word file is made (the server embeds data URLs only). */
async function inlineImages(doc: PouchDoc): Promise<PouchDoc> {
  const cache = new Map<string, Promise<string | null>>();
  const toData = (src: string) => {
    if (!cache.has(src)) {
      cache.set(
        src,
        fetch(src, { credentials: 'include' })
          .then((r) => (r.ok ? r.blob() : Promise.reject()))
          .then((blob) => new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.readAsDataURL(blob);
          }))
          .catch(() => null),
      );
    }
    return cache.get(src)!;
  };
  const walk = async (n: PouchDoc): Promise<PouchDoc> => {
    const src = n.type === 'image' ? String(n.attrs?.['src'] ?? '') : '';
    const attrs = src && !src.startsWith('data:') ? { ...n.attrs, src: (await toData(src)) ?? src } : n.attrs;
    return { ...n, ...(attrs ? { attrs } : {}), ...(n.content ? { content: await Promise.all(n.content.map(walk)) } : {}) };
  };
  return walk(doc);
}

/**
 * Export in a personal format: fills the format with the chosen summaries and shows the result as an editable preview.
 * Changes here are for this one document only (the format stays as it is); "download" makes the Word file.
 */
@Component({
  selector: 'app-pouch-export-modal',
  imports: [FormsModule, NzAlertModule, NzButtonModule, NzIconModule, NzInputModule, PouchEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pouch-export-modal.component.html',
  styleUrl: './pouch-export-modal.component.scss',
})
export class PouchExportModalComponent {
  readonly data = inject<PouchExportData>(NZ_MODAL_DATA);
  readonly ref = inject(NzModalRef);
  private readonly pouch = inject(PouchService);
  private readonly contentTypes = inject(ContentTypeService);

  readonly format = this.data.format;
  readonly doc = signal<PouchDoc | null>(null);
  readonly count = signal(0);
  readonly capped = signal(false);
  readonly failed = signal(false);
  readonly page = signal<IPouchPage>(this.format.page);
  readonly fileName = signal(`${this.format.name} ${formatDate(new Date(), 'dd-MM-yyyy')}`);
  readonly downloading = signal(false);

  private readonly editor = viewChild(PouchEditorComponent);

  constructor() {
    const all = !this.data.selectedIds.length;
    this.pouch.exportData({ summariesId: this.data.selectedIds, all, search: all ? this.data.search : undefined }).subscribe({
      next: ({ summaries, capped }) => {
        // One schema for every rich field (building it per summary would be slow for hundreds).
        const byId = this.contentTypes.fieldsById;
        const schema = getSchema(pouchExtensions({ labelOf: (k) => fieldLabel(k, byId()), repeatRequired: () => false }));
        const parser = PmDOMParser.fromSchema(schema);
        const htmlToBlocks = (html: string): PouchDoc[] => {
          const dom = new DOMParser().parseFromString(`<body>${quillToHtml(html)}</body>`, 'text/html').body;
          return (parser.parse(dom).toJSON() as PouchDoc).content ?? [];
        };
        this.count.set(summaries.length);
        this.capped.set(capped);
        this.doc.set(fillDoc(this.format.doc, this.format.mode, summaries, { htmlToBlocks }));
      },
      error: () => this.failed.set(true),
    });
  }

  async download() {
    const editor = this.editor();
    if (!editor) return;
    this.downloading.set(true);
    try {
      const doc = await inlineImages(editor.json());
      this.pouch.downloadDocx(doc, this.page(), this.fileName().trim() || this.format.name).subscribe({
        complete: () => this.ref.close(true),
        error: () => this.downloading.set(false),
      });
    } catch {
      this.downloading.set(false);
    }
  }
}
