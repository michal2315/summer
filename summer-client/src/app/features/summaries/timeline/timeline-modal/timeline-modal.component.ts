import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { format } from 'date-fns';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzDropDownModule } from 'ng-zorro-antd/dropdown';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { ISummary, SummaryKind } from '../../../../shared/models';
import { saveFile } from '../../../../shared/utils/save-file';

export interface TimelineData {
  /** The summaries the user selected. */
  summaries: ISummary[];
}

/**
 * Horizontal timeline of the summaries the user selected (selection mode → "ציר זמן"), ordered by event date.
 * The title is editable for this timeline; export to png/jpeg (3× scale) or txt.
 */
@Component({
  selector: 'app-timeline-modal',
  imports: [FormsModule, NzButtonModule, NzDropDownModule, NzEmptyModule, NzIconModule, NzInputModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './timeline-modal.component.html',
  styleUrl: './timeline-modal.component.scss',
})
export class TimelineModalComponent {
  private readonly data = inject<TimelineData>(NZ_MODAL_DATA);
  private readonly ref = inject(NzModalRef);
  private readonly router = inject(Router);

  private readonly track = viewChild<ElementRef<HTMLElement>>('track');

  readonly exporting = signal(false);
  readonly editingTitle = signal(false);
  readonly title = signal('ציר זמן');
  readonly draftTitle = signal(this.title());

  readonly sorted = computed(() => this.data.summaries.filter((s) => s.eventDate).sort((a, b) => a.eventDate!.localeCompare(b.eventDate!)));
  /** Selected summaries left off the timeline because they have no event date. */
  readonly undated = this.data.summaries.filter((s) => !s.eventDate).length;

  date(s: ISummary) {
    return format(new Date(s.eventDate!), 'dd/MM/yyyy');
  }

  open(s: ISummary) {
    this.ref.close();
    if (s.kind === SummaryKind.Running) this.router.navigate(['/running', s._id]);
    else if (s.parentId) this.router.navigate(['/running', s.parentId], { queryParams: { summaryId: s._id } });
    else this.router.navigate(['/summaries'], { queryParams: { summaryId: s._id } });
  }

  saveTitle() {
    const t = this.draftTitle().trim();
    if (!t) return;
    this.title.set(t);
    this.editingTitle.set(false);
  }

  /** Mouse wheel scrolls the horizontal track (scrollbars are hidden). */
  onWheel(e: WheelEvent) {
    const el = e.currentTarget as HTMLElement;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      el.scrollLeft -= e.deltaY;
      e.preventDefault();
    }
  }

  async export(kind: 'png' | 'jpeg' | 'txt') {
    const name = `ציר-זמן-${this.title()}`;
    if (kind === 'txt') {
      const lines = [this.title(), '', ...this.sorted().map((s) => `${this.date(s)} — ${s.title}`)];
      saveFile(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), `${name}.txt`);
      return;
    }
    const el = this.track()?.nativeElement;
    if (!el) return;
    this.exporting.set(true);
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(el, { scale: 3, backgroundColor: '#ffffff', width: el.scrollWidth, windowWidth: el.scrollWidth });
      const mime = kind === 'png' ? 'image/png' : 'image/jpeg';
      canvas.toBlob((blob) => blob && saveFile(blob, `${name}.${kind === 'png' ? 'png' : 'jpg'}`), mime, 0.95);
    } finally {
      this.exporting.set(false);
    }
  }
}
