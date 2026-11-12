import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { endOfDay, format, startOfDay } from 'date-fns';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzDatePickerModule } from 'ng-zorro-antd/date-picker';
import { NzDropDownModule } from 'ng-zorro-antd/dropdown';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NZ_MODAL_DATA, NzModalRef, NzModalService } from 'ng-zorro-antd/modal';
import { NzPopoverModule } from 'ng-zorro-antd/popover';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { ISummary, SummaryKind } from '../../../../shared/models';
import { saveFile } from '../../../../shared/utils/save-file';

export interface TimelineData {
  /** The summaries the user selected. */
  summaries: ISummary[];
}

/** Which summary date places it on the track. */
export type TimelineBasis = 'event' | 'creation';

/** A free-text event the user added to this timeline only (not saved). */
interface CustomEvent {
  id: number;
  title: string;
  date: Date;
}

/** One card on the track: either a selected summary or a custom event. */
interface TimelineItem {
  key: string;
  date: Date;
  title: string;
  color?: string;
  summary?: ISummary;
  event?: CustomEvent;
}

/**
 * Horizontal timeline of the summaries the user selected (selection mode → "ציר זמן").
 * Actions bar: add (a new summary via the create form in a modal, or a custom event on this timeline), a date range filter,
 * placing summaries by event date or creation date, and export to png/jpeg (3× scale) or txt.
 */
@Component({
  selector: 'app-timeline-modal',
  imports: [
    FormsModule,
    NzButtonModule,
    NzDatePickerModule,
    NzDropDownModule,
    NzEmptyModule,
    NzIconModule,
    NzInputModule,
    NzPopoverModule,
    NzRadioModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './timeline-modal.component.html',
  styleUrl: './timeline-modal.component.scss',
})
export class TimelineModalComponent {
  private readonly data = inject<TimelineData>(NZ_MODAL_DATA);
  private readonly ref = inject(NzModalRef);
  private readonly router = inject(Router);
  private readonly modal = inject(NzModalService);

  /** The selected summaries, plus ones created from this timeline. */
  private readonly summaries = signal<ISummary[]>(this.data.summaries);

  private readonly track = viewChild<ElementRef<HTMLElement>>('track');

  readonly exporting = signal(false);
  readonly editingTitle = signal(false);
  readonly title = signal('ציר זמן');
  readonly draftTitle = signal(this.title());

  readonly basis = signal<TimelineBasis>('event');
  /** [from, to]; empty = no limit. */
  readonly range = signal<Date[]>([]);

  readonly events = signal<CustomEvent[]>([]);
  private nextEventId = 1;
  readonly addingEvent = signal(false);
  readonly eventTitle = signal('');
  readonly eventDate = signal<Date | null>(null);

  /** Everything with a date under the current basis, before the range filter, ordered by date. */
  private readonly dated = computed<TimelineItem[]>(() => {
    const basis = this.basis();
    const summaries = this.summaries().flatMap((s): TimelineItem[] => {
      const raw = basis === 'event' ? s.eventDate : s.creationDate;
      return raw ? [{ key: s._id, date: new Date(raw), title: s.title, color: s.color || undefined, summary: s }] : [];
    });
    const events = this.events().map((e): TimelineItem => ({ key: `event-${e.id}`, date: e.date, title: e.title, event: e }));
    return [...summaries, ...events].sort((a, b) => a.date.getTime() - b.date.getTime());
  });

  readonly items = computed(() => {
    const [from, to] = this.range();
    if (!from || !to) return this.dated();
    const min = startOfDay(from).getTime();
    const max = endOfDay(to).getTime();
    return this.dated().filter((i) => i.date.getTime() >= min && i.date.getTime() <= max);
  });

  /** Selected summaries left off because they have no event date (only when placing by event date). */
  readonly undated = computed(() => (this.basis() === 'event' ? this.summaries().filter((s) => !s.eventDate).length : 0));
  /** Items hidden by the range filter. */
  readonly outOfRange = computed(() => this.dated().length - this.items().length);

  date(i: TimelineItem) {
    return format(i.date, 'dd/MM/yyyy');
  }

  open(i: TimelineItem) {
    const s = i.summary;
    if (!s) return;
    this.ref.close();
    if (s.kind === SummaryKind.Running) this.router.navigate(['/running', s._id]);
    else if (s.parentId) this.router.navigate(['/running', s.parentId], { queryParams: { summaryId: s._id } });
    else this.router.navigate(['/summaries'], { queryParams: { summaryId: s._id } });
  }

  /** The create form in a modal over this one; once published, the summary joins this timeline. */
  async newSummary() {
    const { CreateSummaryComponent } = await import('../../create-summary/create-summary.component');
    const ref = this.modal.create<InstanceType<typeof CreateSummaryComponent>, unknown, ISummary>({
      nzTitle: undefined,
      nzContent: CreateSummaryComponent,
      nzFooter: null,
      nzWidth: 'min(1000px, 94vw)',
      nzMaskClosable: false,
      nzBodyStyle: { maxHeight: '82vh', overflowY: 'auto', paddingBottom: '0' },
      // Unsaved changes: ask before closing, like leaving the create page.
      nzOnCancel: (c) => c.canLeave() || this.confirmDiscard(),
    });
    ref.afterClose.subscribe((s) => {
      if (s) this.summaries.update((list) => [...list, s]);
    });
  }

  private confirmDiscard() {
    return new Promise<boolean>((done) =>
      this.modal.confirm({
        nzTitle: 'לצאת ללא שמירה?',
        nzContent: 'השינויים שביצעת לא יישמרו. ליציאה ללא שמירה לחץ אישור.',
        nzOkText: 'אישור',
        nzCancelText: 'ביטול',
        nzOkDanger: true,
        nzOnOk: () => done(true),
        nzOnCancel: () => done(false),
      }),
    );
  }

  startEvent() {
    this.eventTitle.set('');
    this.eventDate.set(null);
    this.addingEvent.set(true);
  }

  addEvent() {
    const title = this.eventTitle().trim();
    const date = this.eventDate();
    if (!title || !date) return;
    this.events.update((list) => [...list, { id: this.nextEventId++, title, date }]);
    this.addingEvent.set(false);
  }

  removeEvent(e: CustomEvent) {
    this.events.update((list) => list.filter((x) => x.id !== e.id));
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
      const lines = [this.title(), '', ...this.items().map((i) => `${this.date(i)} — ${i.title}`)];
      saveFile(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), `${name}.txt`);
      return;
    }
    const el = this.track()?.nativeElement;
    if (!el) return;
    this.exporting.set(true);
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(el, {
        scale: 3,
        backgroundColor: '#ffffff',
        width: el.scrollWidth,
        windowWidth: el.scrollWidth,
        // Remove buttons on custom events don't belong in the image.
        ignoreElements: (node) => node.classList.contains('remove'),
      });
      const mime = kind === 'png' ? 'image/png' : 'image/jpeg';
      canvas.toBlob((blob) => blob && saveFile(blob, `${name}.${kind === 'png' ? 'png' : 'jpg'}`), mime, 0.95);
    } finally {
      this.exporting.set(false);
    }
  }
}
