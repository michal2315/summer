import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { ISummarySearch } from '../../../../shared/models';
import { SummaryService } from '../../../../shared/services/summary.service';

export interface ExportWordData {
  selectedIds: string[];
  /** The list's current search, for "all results". */
  search?: ISummarySearch;
}

/** Word export: the Excel table plus the user's own title and text before/after it. */
@Component({
  selector: 'app-export-word-modal',
  imports: [FormsModule, NzButtonModule, NzIconModule, NzInputModule, NzRadioModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './export-word-modal.component.html',
  styleUrl: './export-word-modal.component.scss',
})
export class ExportWordModalComponent {
  readonly data = inject<ExportWordData>(NZ_MODAL_DATA);
  readonly modal = inject(NzModalRef);
  private readonly summaries = inject(SummaryService);

  readonly all = signal(!this.data.selectedIds.length);
  readonly title = signal('');
  readonly intro = signal('');
  readonly outro = signal('');
  readonly busy = signal(false);

  create() {
    const all = this.all();
    this.busy.set(true);
    this.summaries
      .exportWord({
        summariesId: all ? [] : this.data.selectedIds,
        all,
        search: all ? this.data.search : undefined,
        title: this.title(),
        intro: this.intro(),
        outro: this.outro(),
      })
      .subscribe({
        complete: () => this.modal.close(true),
        error: () => this.busy.set(false),
      });
  }
}
