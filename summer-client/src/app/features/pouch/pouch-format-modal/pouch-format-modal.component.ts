import { ChangeDetectionStrategy, Component, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NZ_MODAL_DATA, NzModalRef, NzModalService } from 'ng-zorro-antd/modal';
import { NzSegmentedModule } from 'ng-zorro-antd/segmented';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { IPouchFormat, IPouchPage, PouchMode } from '../../../shared/models';
import { PouchService } from '../../../shared/services/pouch.service';
import { PouchEditorComponent } from '../editor/pouch-editor/pouch-editor.component';
import { PouchShareComponent, PouchShareData } from '../pouch-share/pouch-share.component';
import { starterDoc } from '../starter-docs';

export interface PouchFormatModalData {
  /** Edit this format (the user's own); none: a new one. */
  format?: IPouchFormat;
}

const MODES: { value: PouchMode; label: string }[] = [
  { value: 'perSummary', label: 'בלוק לכל תמצית' },
  { value: 'combined', label: 'מאוחד' },
];

/**
 * Pouch: create or edit a personal export format. A name, the mode (a block repeated per summary between a fixed start
 * and end, or one document whose fields list every summary's value), and the editor. Closes with the saved format.
 */
@Component({
  selector: 'app-pouch-format-modal',
  imports: [FormsModule, NzButtonModule, NzIconModule, NzInputModule, NzSegmentedModule, NzToolTipModule, PouchEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pouch-format-modal.component.html',
  styleUrl: './pouch-format-modal.component.scss',
})
export class PouchFormatModalComponent {
  private readonly data = inject<PouchFormatModalData>(NZ_MODAL_DATA);
  private readonly ref = inject(NzModalRef<PouchFormatModalComponent, IPouchFormat>);
  private readonly pouch = inject(PouchService);
  private readonly modal = inject(NzModalService);
  private readonly message = inject(NzMessageService);

  readonly existing = this.data.format;
  /** New formats and ones the user owns or edits can change; viewers only look (and may copy). */
  readonly canEdit = !this.existing || this.existing.canEdit;
  readonly copying = signal(false);
  readonly modes = MODES;
  readonly name = signal(this.existing?.name ?? '');
  readonly mode = signal<PouchMode>(this.existing?.mode ?? 'perSummary');
  readonly page = signal<IPouchPage>(this.existing?.page ?? { orientation: 'portrait', margins: 'normal' });
  readonly doc = this.existing?.doc ?? starterDoc('perSummary');
  readonly saving = signal(false);
  readonly dirty = signal(false);

  private readonly editor = viewChild.required(PouchEditorComponent);

  setMode(mode: PouchMode) {
    if (mode === this.mode()) return;
    this.mode.set(mode);
    this.editor().applyMode(mode);
    this.dirty.set(true);
  }

  setPage(page: IPouchPage) {
    this.page.set(page);
    this.dirty.set(true);
  }

  save() {
    const name = this.name().trim();
    if (!name) {
      this.message.warning('צריך לתת לפורמט שם');
      return;
    }
    const payload = { name, mode: this.mode(), page: this.page(), doc: this.editor().json() };
    this.saving.set(true);
    const req = this.existing ? this.pouch.update(this.existing._id, payload) : this.pouch.create({ ...payload, isFavorite: false, isShared: false, members: [] });
    req.subscribe({
      next: (f) => {
        this.message.success(this.existing ? 'הפורמט נשמר' : `הפורמט "${f.name}" נוצר`);
        this.ref.close(f);
      },
      error: () => this.saving.set(false),
    });
  }

  /** Sharing and editors: the owner's, on a saved format. */
  share() {
    const f = this.existing;
    if (!f?.isMine) return;
    this.modal.create<PouchShareComponent, PouchShareData, IPouchFormat>({ nzTitle: `שיתוף "${f.name}"`, nzContent: PouchShareComponent, nzData: { format: f }, nzFooter: null, nzWidth: 480 });
  }

  /** A viewer's own private copy, opened right away for editing. */
  copyToMine() {
    const f = this.existing;
    if (!f) return;
    this.copying.set(true);
    this.pouch.copy(f._id).subscribe({
      next: (mine) => {
        this.message.success(`הפורמט "${mine.name}" נוסף לפורמטים שלך`);
        this.ref.close(mine);
      },
      error: () => this.copying.set(false),
    });
  }

  cancel() {
    if (!this.dirty()) return this.ref.close();
    this.modal.confirm({
      nzTitle: 'לצאת בלי לשמור?',
      nzContent: 'השינויים בפורמט לא יישמרו.',
      nzOkText: 'יציאה',
      nzOkDanger: true,
      nzCancelText: 'המשך עריכה',
      nzOnOk: () => this.ref.close(),
    });
  }
}
