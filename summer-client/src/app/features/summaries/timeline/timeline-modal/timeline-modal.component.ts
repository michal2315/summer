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
import { NzMessageService } from 'ng-zorro-antd/message';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { NzPopoverModule } from 'ng-zorro-antd/popover';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { UserService } from '../../../../core/auth/user.service';
import { ISummary, SummaryKind, SummaryPayload } from '../../../../shared/models';
import { ContentTypeService } from '../../../../shared/services/content-type.service';
import { PermissionService } from '../../../../shared/services/permission.service';
import { SummaryService } from '../../../../shared/services/summary.service';
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

/** The values every one of the lists holds. */
function shared<T>(lists: T[][]): T[] {
  return lists.length ? lists.reduce((acc, cur) => acc.filter((x) => cur.includes(x))) : [];
}

function escapeHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Horizontal timeline of the summaries the user selected (selection mode → "ציר זמן").
 * Actions bar: add (a quick new summary — title, link, permissions — that joins this timeline, or a custom event on it),
 * a date range filter, placing summaries by event date or creation date, and export to png/jpeg (3× scale), txt or Visio (editable shapes).
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
    NzSelectModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './timeline-modal.component.html',
  styleUrl: './timeline-modal.component.scss',
})
export class TimelineModalComponent {
  private readonly data = inject<TimelineData>(NZ_MODAL_DATA);
  private readonly ref = inject(NzModalRef);
  private readonly router = inject(Router);
  private readonly message = inject(NzMessageService);
  private readonly summaryService = inject(SummaryService);
  private readonly users = inject(UserService);
  readonly contentTypes = inject(ContentTypeService);
  readonly permissionGroups = inject(PermissionService);

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

  // ---- quick new summary, added to this timeline ----
  readonly creatingSummary = signal(false);
  readonly savingSummary = signal(false);
  readonly summaryTitle = signal('');
  readonly summaryLink = signal('');
  readonly permissions = signal<string[]>([]);
  readonly linkValid = computed(() => /^(https?:\/\/\S+)?$/i.test(this.summaryLink().trim()));
  readonly canCreateSummary = computed(
    () => !!this.summaryTitle().trim() && this.linkValid() && this.permissions().length > 0 && !this.savingSummary(),
  );

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
    this.router.navigateByUrl(this.summaryUrl(s));
  }

  private summaryUrl(s: ISummary): string {
    const tree =
      s.kind === SummaryKind.Running
        ? this.router.createUrlTree(['/running', s._id])
        : s.parentId
          ? this.router.createUrlTree(['/running', s.parentId], { queryParams: { summaryId: s._id } })
          : this.router.createUrlTree(['/summaries'], { queryParams: { summaryId: s._id } });
    return this.router.serializeUrl(tree);
  }

  /** Opens the quick form; permissions start as the ones every selected summary has (and the user may assign). */
  startSummary() {
    this.summaryTitle.set('');
    this.summaryLink.set('');
    const assignable = new Set(this.permissionGroups.assignable().map((p) => p._id));
    this.permissions.set(shared(this.data.summaries.map((s) => s.permissions.map((p) => p._id))).filter((id) => assignable.has(id)));
    this.creatingSummary.set(true);
  }

  /**
   * Publishes a summary from just a title, link and permissions, dated today so it lands on the track, and adds it to
   * this timeline. It is filed under the generic content type; the link doubles as its content.
   */
  createSummary() {
    if (!this.canCreateSummary()) return;
    const title = this.summaryTitle().trim();
    const link = this.summaryLink().trim();
    const generic = this.contentTypes.list().find((t) => t.name === 'generic');
    if (!generic) {
      this.message.error('סוג התוכן הכללי לא נמצא');
      return;
    }
    const payload: SummaryPayload = {
      kind: SummaryKind.Summary,
      title,
      contentHtml: link ? `<p><a href="${escapeHtml(link)}" target="_blank">${escapeHtml(link)}</a></p>` : `<p>${escapeHtml(title)}</p>`,
      notesHtml: '',
      contentType: generic._id,
      eventDate: format(new Date(), 'yyyy-MM-dd'),
      department: this.users.user()?.department ?? '',
      labels: [],
      permissions: this.permissions(),
      taggedUsers: [],
      taggedPermissions: [],
      summaryFields: [],
      files: [],
      // Only a sumaroon has a link field (the server refuses it on a summary), so it lives in the content.
      isDraft: false,
    };
    this.savingSummary.set(true);
    this.summaryService.create(payload, []).subscribe({
      next: (s) => {
        this.summaries.update((list) => [...list, s]);
        this.savingSummary.set(false);
        this.creatingSummary.set(false);
        this.message.success('התמצית נוספה לציר');
      },
      error: () => this.savingSummary.set(false),
    });
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

  async export(kind: 'png' | 'jpeg' | 'txt' | 'vsdx') {
    const name = `ציר-זמן-${this.title()}`;
    if (kind === 'txt') {
      const lines = [this.title(), '', ...this.items().map((i) => `${this.date(i)} — ${i.title}`)];
      saveFile(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), `${name}.txt`);
      return;
    }
    this.exporting.set(true);
    try {
      if (kind === 'vsdx') {
        // Loaded on demand, like html2canvas, so the zip library stays out of the main bundle.
        const { VSDX_MIME, buildTimelineVsdx, hexColor } = await import('../timeline-vsdx');
        const accent = hexColor(getComputedStyle(document.documentElement).getPropertyValue('--primary-orange')) ?? '#FF7EB9';
        const file = buildTimelineVsdx({
          title: this.title(),
          accent,
          items: this.items().map((i) => ({
            date: this.date(i),
            title: i.title,
            color: i.color,
            custom: !!i.event,
            link: i.summary ? new URL(this.summaryUrl(i.summary), location.origin).href : undefined,
          })),
        });
        saveFile(new Blob([file as BlobPart], { type: VSDX_MIME }), `${name}.vsdx`);
        return;
      }
      const blob = await this.render(kind);
      if (blob) saveFile(blob, `${name}.${kind === 'png' ? 'png' : 'jpg'}`);
    } finally {
      this.exporting.set(false);
    }
  }

  /** The track as an image (3× scale), or null when it isn't on screen (nothing to show). */
  private async render(kind: 'png' | 'jpeg'): Promise<Blob | null> {
    const el = this.track()?.nativeElement;
    if (!el) return null;
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(el, {
      scale: 3,
      backgroundColor: '#ffffff',
      width: el.scrollWidth,
      windowWidth: el.scrollWidth,
      // Remove buttons on custom events don't belong in the image.
      ignoreElements: (node) => node.classList.contains('remove'),
    });
    return new Promise((done) => canvas.toBlob(done, kind === 'png' ? 'image/png' : 'image/jpeg', 0.95));
  }
}
