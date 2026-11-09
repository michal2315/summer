import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked, viewChild, viewChildren } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { TourHubComponent } from '../tour-hub/tour-hub.component';
import { TourStep } from '../tour-spec';
import { TourService } from '../tour.service';

/** Gap between the spotlight ring and its element, and between the ring and the bubble. */
const PAD = 6;
const GAP = 14;
/** The bubble dims (not hidden) only when a step's prep takes noticeably long. */
const BUSY_DELAY_MS = 180;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
const onScreen = (r: DOMRect) => r.width > 2 && r.height > 2 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.matches('input, textarea, select') || t.isContentEditable);

interface KeyHint {
  keys: string[];
  label: string;
}

/**
 * Rendered once in the app root: the tour's spotlight (four dimming blocks around a ring) and step bubble,
 * the "?" hub, and the what's-new nudge. Positions are written straight to the DOM every frame so the
 * spotlight follows its element through scrolling, resizing and layout changes without change detection.
 */
@Component({
  selector: 'app-tour-overlay',
  imports: [NzButtonModule, NzIconModule, TourHubComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tour-overlay.component.html',
  styleUrl: './tour-overlay.component.scss',
})
export class TourOverlayComponent {
  readonly tour = inject(TourService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly document = inject(DOCUMENT);

  private readonly blocks = viewChildren<ElementRef<HTMLElement>>('block');
  private readonly hole = viewChild<ElementRef<HTMLElement>>('hole');
  private readonly pop = viewChild<ElementRef<HTMLElement>>('pop');

  /** The step on screen — lags tour.current() while the next step's prep runs. */
  readonly shown = signal<TourStep | null>(null);
  readonly doing = signal(false);
  readonly hasTarget = signal(false);
  readonly busy = signal(false);
  readonly done = signal(false);
  readonly entered = signal(false);

  readonly keyHints = computed<KeyHint[]>(() =>
    (this.shown()?.kbd ?? []).map((k) => {
      const [combo, ...label] = k.split(' ');
      return { keys: combo.split('+'), label: label.join(' ') };
    }),
  );
  readonly unseenNewTitles = computed(() => {
    const list = this.tour.unseenNew();
    return list.slice(0, 2).map((s) => s.title).join(', ') + (list.length > 2 ? '…' : '');
  });

  private target: HTMLElement | null = null;
  private token = 0;
  private raf = 0;
  private poll = 0;
  private lastLayout = '';

  constructor() {
    effect(() => {
      const step = this.tour.current();
      untracked(() => (step ? this.show(step) : this.stop()));
    });

    const win = this.document.defaultView!;
    const onKey = (e: KeyboardEvent) => this.onKey(e);
    const onDown = (e: MouseEvent) => this.closeHubOnOutside(e);
    win.addEventListener('keydown', onKey, true);
    win.addEventListener('mousedown', onDown, true);
    inject(DestroyRef).onDestroy(() => {
      this.stop();
      win.removeEventListener('keydown', onKey, true);
      win.removeEventListener('mousedown', onDown, true);
    });
  }

  next() {
    this.tour.go(1);
  }

  prev() {
    this.tour.go(-1);
  }

  close() {
    this.tour.end();
  }

  runAction(step: TourStep) {
    this.tour.end();
    setTimeout(() => step.action?.run(this.tour.ctx), 60);
  }

  private async show(step: TourStep) {
    const token = ++this.token;
    this.clearTimers();
    const busyTimer = setTimeout(() => this.busy.set(true), BUSY_DELAY_MS);
    try {
      await step.prep?.(this.tour.ctx);
    } catch {
      /* a failed prep still shows the step, as a centered card if its element is missing */
    }
    if (token !== this.token) return;
    const target = step.sel ? await this.waitFor(step.sel) : null;
    clearTimeout(busyTimer);
    if (token !== this.token) return;

    this.tour.markSeen(step);
    this.target = target;
    const doing = !!(step.do && target && !step.do.until(this.tour.ctx));
    this.busy.set(false);
    this.done.set(false);
    this.doing.set(doing);
    this.hasTarget.set(!!target);
    this.shown.set(step);

    if (doing) {
      this.poll = window.setInterval(() => {
        if (!step.do!.until(this.tour.ctx)) return;
        clearInterval(this.poll);
        this.done.set(true);
        setTimeout(() => token === this.token && this.tour.go(1), 550);
      }, 200);
    }

    await frame();
    if (token !== this.token) return;
    this.lastLayout = '';
    this.place();
    this.entered.set(true);
    const primary = this.pop()?.nativeElement.querySelector<HTMLElement>('.primary-action');
    primary?.focus({ preventScroll: true });
  }

  private stop() {
    this.token++;
    this.clearTimers();
    this.target = null;
    this.shown.set(null);
    this.entered.set(false);
    this.busy.set(false);
  }

  private clearTimers() {
    clearInterval(this.poll);
    cancelAnimationFrame(this.raf);
  }

  /** Lay out the blocks, ring and bubble around the target, then keep following it every frame. */
  private place() {
    const step = this.shown();
    const pop = this.pop()?.nativeElement;
    const hole = this.hole()?.nativeElement;
    const blocks = this.blocks().map((b) => b.nativeElement);
    if (!step || !pop || !hole || blocks.length !== 4) return;

    // Angular may re-render the target (e.g. a list reload) — look it up again.
    if (this.target && !this.target.isConnected) this.target = this.find(step.sel);
    let r = this.target?.getBoundingClientRect() ?? null;
    if (r && !onScreen(r)) r = null;

    const W = innerWidth;
    const H = innerHeight;
    const x = r ? Math.max(4, r.left - PAD) : W / 2;
    const y = r ? Math.max(4, r.top - PAD) : H / 2;
    const w = r ? Math.min(W - 8, r.right + PAD) - x : 0;
    const h = r ? Math.min(H - 8, r.bottom + PAD) - y : 0;
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;

    const layout = [x, y, w, h, W, H, pw, ph].map(Math.round).join();
    if (layout !== this.lastLayout) {
      this.lastLayout = layout;
      this.setBox(hole, x, y, w, h);
      if (r) hole.style.borderRadius = this.ringRadius(this.target!, r);
      this.setBox(blocks[0], 0, 0, W, y);
      this.setBox(blocks[1], 0, y + h, W, Math.max(0, H - y - h));
      this.setBox(blocks[2], 0, y, x, h);
      this.setBox(blocks[3], x + w, y, Math.max(0, W - x - w), h);

      // Below, above, beside — whichever fits first; centered when nothing is spotlighted.
      let px: number;
      let py: number;
      if (!r) {
        px = (W - pw) / 2;
        py = (H - ph) / 2;
      } else if (y + h + GAP + ph < H - 8) {
        px = x + w / 2 - pw / 2;
        py = y + h + GAP;
      } else if (y - GAP - ph > 8) {
        px = x + w / 2 - pw / 2;
        py = y - GAP - ph;
      } else if (x - GAP - pw > 8) {
        px = x - GAP - pw;
        py = y + h / 2 - ph / 2;
      } else if (x + w + GAP + pw < W - 8) {
        px = x + w + GAP;
        py = y + h / 2 - ph / 2;
      } else {
        px = (W - pw) / 2;
        py = H - ph - 16;
      }
      px = Math.max(8, Math.min(W - pw - 8, px));
      py = Math.max(8, Math.min(H - ph - 8, py));
      pop.style.transform = `translate(${Math.round(px)}px, ${Math.round(py)}px)`;
    }
    this.raf = requestAnimationFrame(() => this.place());
  }

  /** The target's own corner radii, grown by PAD so the ring runs parallel to its edge. */
  private ringRadius(el: HTMLElement, r: DOMRect): string {
    const style = getComputedStyle(el);
    const corners = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius];
    return corners
      .map((c) => {
        const v = parseFloat(c) || 0; // elliptical radii ('8px 4px'): the first value is close enough
        const px = c.trim().endsWith('%') ? (v / 100) * Math.min(r.width, r.height) : v;
        return `${Math.min(px, Math.min(r.width, r.height) / 2) + PAD}px`;
      })
      .join(' ');
  }

  private setBox(el: HTMLElement, left: number, top: number, width: number, height: number) {
    Object.assign(el.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
  }

  private async waitFor(sel: string | string[], ms = 1200): Promise<HTMLElement | null> {
    const until = Date.now() + ms;
    let el = this.find(sel);
    while (!el && Date.now() < until) {
      await wait(40);
      el = this.find(sel);
    }
    return el;
  }

  /** First match that is on screen and not covered by something else (e.g. clipped by a collapsed sider). */
  private find(sel: string | string[] | undefined): HTMLElement | null {
    for (const s of [sel ?? []].flat()) {
      for (const el of this.document.querySelectorAll<HTMLElement>(s)) {
        if (onScreen(el.getBoundingClientRect()) && this.reachable(el)) return el;
      }
    }
    return null;
  }

  private reachable(el: HTMLElement): boolean {
    const r = el.getBoundingClientRect();
    const x = Math.min(innerWidth - 2, Math.max(1, r.left + r.width / 2));
    const y = Math.min(innerHeight - 2, Math.max(1, r.top + r.height / 2));
    // Look through our own layers.
    this.host.classList.add('probe');
    const hit = this.document.elementFromPoint(x, y);
    this.host.classList.remove('probe');
    return !!hit && (hit === el || el.contains(hit));
  }

  private onKey(e: KeyboardEvent) {
    if (!this.tour.current()) {
      if (e.key === 'Escape' && this.tour.hubAnchor()) this.tour.closeHub();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
      return;
    }
    // While the user is asked to type somewhere, arrows belong to that field.
    if (this.doing() && isTyping(e.target)) return;
    // RTL: left is forward.
    if (e.key === 'ArrowLeft' && !this.doing()) {
      e.preventDefault();
      e.stopPropagation();
      this.next();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      this.prev();
    }
  }

  private closeHubOnOutside(e: MouseEvent) {
    const anchor = this.tour.hubAnchor();
    const t = e.target as Node;
    if (!anchor || anchor.contains(t) || this.host.querySelector('app-tour-hub')?.contains(t)) return;
    this.tour.closeHub();
  }
}
