import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, afterNextRender, inject, input, signal, viewChild } from '@angular/core';

const MIN_THUMB = 32;

/**
 * Always-visible scrollbar for a scroll container (native scrollbars are hidden app-wide).
 * Drag the thumb, or click the track to jump; while dragging, a label beside the thumb shows `labelAt(y)` —
 * e.g. the date of the item under the thumb. Place it in a `position: relative` wrapper next to the scroller.
 */
@Component({
  selector: 'app-scroll-rail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'scrollbar',
    'aria-orientation': 'vertical',
    '[attr.aria-valuenow]': 'percent()',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    '[class.dragging]': 'dragging()',
    '[class.hidden]': '!scrollable()',
    '(pointerdown)': 'onTrackDown($event)',
  },
  templateUrl: './scroll-rail.component.html',
  styleUrl: './scroll-rail.component.scss',
})
export class ScrollRailComponent {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly zone = inject(NgZone);

  readonly scroller = input.required<HTMLElement>();
  /** Text for the item at viewport y (clientY), or null for no label. */
  readonly labelAt = input<(clientY: number) => string | null>(() => null);

  private readonly thumb = viewChild.required<ElementRef<HTMLElement>>('thumb');

  readonly dragging = signal(false);
  readonly label = signal<string | null>(null);
  readonly scrollable = signal(false);
  readonly percent = signal(0);

  private thumbH = MIN_THUMB;
  private frame = 0;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.scroller();
      // Scroll events fire a lot; position the thumb outside Angular and only touch signals when values change.
      this.zone.runOutsideAngular(() => {
        const schedule = () => {
          cancelAnimationFrame(this.frame);
          this.frame = requestAnimationFrame(() => this.sync());
        };
        el.addEventListener('scroll', schedule, { passive: true });

        // Content grows on infinite scroll and when views switch: watch sizes of the scroller and its children.
        const resize = new ResizeObserver(schedule);
        const observeChildren = () => {
          resize.disconnect();
          resize.observe(el);
          resize.observe(this.host.nativeElement);
          for (const child of Array.from(el.children)) resize.observe(child);
        };
        const mutations = new MutationObserver(() => {
          observeChildren();
          schedule();
        });
        mutations.observe(el, { childList: true });
        observeChildren();
        schedule();

        destroyRef.onDestroy(() => {
          el.removeEventListener('scroll', schedule);
          resize.disconnect();
          mutations.disconnect();
          cancelAnimationFrame(this.frame);
        });
      });
    });
  }

  /** Position and size the thumb from the scroller's current scroll state. */
  private sync() {
    const el = this.scroller();
    const track = this.host.nativeElement.clientHeight;
    const max = el.scrollHeight - el.clientHeight;
    const scrollable = max > 1 && track > 0;
    if (scrollable !== this.scrollable()) this.zone.run(() => this.scrollable.set(scrollable));
    if (!scrollable) return;

    this.thumbH = Math.max(MIN_THUMB, (track * el.clientHeight) / el.scrollHeight);
    const top = ((track - this.thumbH) * el.scrollTop) / max;
    const thumb = this.thumb().nativeElement;
    thumb.style.height = `${this.thumbH}px`;
    thumb.style.transform = `translateY(${top}px)`;

    const percent = Math.round((el.scrollTop / max) * 100);
    if (percent !== this.percent()) this.zone.run(() => this.percent.set(percent));
    if (this.dragging()) this.updateLabel();
  }

  private updateLabel() {
    const rect = this.thumb().nativeElement.getBoundingClientRect();
    const text = this.labelAt()(rect.top + rect.height / 2);
    if (text !== this.label()) this.zone.run(() => this.label.set(text));
  }

  onThumbDown(e: PointerEvent) {
    e.stopPropagation();
    this.startDrag(e);
  }

  /** Click on the empty track: jump so the thumb centers on the pointer, then keep dragging. */
  onTrackDown(e: PointerEvent) {
    const el = this.scroller();
    const rect = this.host.nativeElement.getBoundingClientRect();
    const ratio = (e.clientY - rect.top - this.thumbH / 2) / (rect.height - this.thumbH);
    el.scrollTop = Math.max(0, Math.min(1, ratio)) * (el.scrollHeight - el.clientHeight);
    this.startDrag(e);
  }

  private startDrag(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = this.scroller();
    const target = this.host.nativeElement;
    target.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startScroll = el.scrollTop;
    this.dragging.set(true);
    requestAnimationFrame(() => this.updateLabel());

    const move = (ev: PointerEvent) => {
      const track = target.clientHeight - this.thumbH;
      const max = el.scrollHeight - el.clientHeight;
      if (track > 0) el.scrollTop = startScroll + ((ev.clientY - startY) * max) / track;
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      this.zone.run(() => {
        this.dragging.set(false);
        this.label.set(null);
      });
    };
    this.zone.runOutsideAngular(() => {
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
      target.addEventListener('pointercancel', up);
    });
  }
}
