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
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { Observable } from 'rxjs';
import { UserService } from '../../../core/auth/user.service';
import { ISummariesResponse, ISummary } from '../../../shared/models';
import { CollectionService } from '../../../shared/services/collection.service';
import { SummaryService } from '../../../shared/services/summary.service';
import { saveFile } from '../../../shared/utils/save-file';

export interface TimelineData {
  summary: ISummary;
}

const MAX_EVENTS = 100;

/**
 * Horizontal timeline of the summary's series — the other summaries in its collection (or, without one, sharing its
 * first label, e.g. the course), ordered by event date. Title is editable; export to png/jpeg (3× scale) or txt.
 */
@Component({
  selector: 'app-timeline-modal',
  imports: [FormsModule, NzButtonModule, NzDropDownModule, NzEmptyModule, NzIconModule, NzInputModule, NzSpinModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './timeline-modal.component.html',
  styleUrl: './timeline-modal.component.scss',
})
export class TimelineModalComponent {
  private readonly data = inject<TimelineData>(NZ_MODAL_DATA);
  private readonly ref = inject(NzModalRef);
  private readonly summaries = inject(SummaryService);
  private readonly collections = inject(CollectionService);
  private readonly users = inject(UserService);
  private readonly router = inject(Router);

  private readonly track = viewChild<ElementRef<HTMLElement>>('track');

  readonly current = this.data.summary;
  readonly events = signal<ISummary[] | null>(null);
  readonly exporting = signal(false);
  readonly editingTitle = signal(false);
  readonly title = signal(this.current.timelineTitle || this.current.collectionIds[0]?.name || this.current.labels[0]?.name || this.current.title);
  readonly draftTitle = signal(this.title());

  readonly isMine = this.current.user._id === this.users.userId();
  readonly sorted = computed(() =>
    (this.events() ?? []).filter((s) => s.eventDate).sort((a, b) => a.eventDate!.localeCompare(b.eventDate!)),
  );

  constructor() {
    const collection = this.current.collectionIds[0];
    const search = { sort: 'eventDate' as const, limit: MAX_EVENTS, skip: 0 };
    const req: Observable<ISummariesResponse> = collection
      ? this.collections.summaries(collection._id, search)
      : this.summaries.search(this.users.userId()!, { ...search, labels: this.current.labels.slice(0, 1).map((l) => l.name) });
    req.subscribe({
      next: (res) => this.events.set(res.summaries.some((s) => s._id === this.current._id) ? res.summaries : [this.current, ...res.summaries]),
      error: () => this.events.set([this.current]),
    });
  }

  date(s: ISummary) {
    return format(new Date(s.eventDate!), 'dd/MM/yyyy');
  }

  open(s: ISummary) {
    this.ref.close();
    this.router.navigate(['/summaries'], { queryParams: { summaryId: s._id } });
  }

  saveTitle() {
    const t = this.draftTitle().trim();
    if (!t) return;
    this.summaries.updateTimelineTitle(this.current, t).subscribe(() => {
      this.title.set(t);
      this.editingTitle.set(false);
    });
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
