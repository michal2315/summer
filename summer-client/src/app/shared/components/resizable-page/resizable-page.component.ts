import { ChangeDetectionStrategy, Component, OnInit, inject, input, output, signal } from '@angular/core';
import { StorageService } from '../../../core/storage/storage.service';

/**
 * Two-pane page: list (main) + detail (aside), with a drag handle between them.
 * The list fills the space; the handle sizes the aside, which never exceeds 40% of the page (CSS max-width: 40vw).
 * The aside width is persisted under `storageKey` (default "feedWidth").
 * The aside is always shown on wide screens (the consumer renders an empty state when nothing is open).
 * Below 1100px it becomes a full-screen overlay, shown only while `asideOpen`.
 */
@Component({
  selector: 'app-resizable-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.aside-open]': 'asideOpen()' },
  templateUrl: './resizable-page.component.html',
  styleUrl: './resizable-page.component.scss',
})
export class ResizablePageComponent implements OnInit {
  private readonly storage = inject(StorageService);

  readonly minWidth = input(260);
  readonly defaultWidth = input(480);
  readonly storageKey = input('feedWidth');
  readonly asideOpen = input(false);
  readonly closeAside = output<void>();

  readonly width = signal(480);

  ngOnInit() {
    this.setWidth(this.storage.get<number>(this.storageKey()) ?? this.defaultWidth());
  }

  startDrag(e: PointerEvent) {
    const handle = e.target as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = this.width();
    // RTL: the aside is on the left, so dragging the handle right (larger clientX) widens it.
    const move = (ev: PointerEvent) => this.setWidth(startW + (ev.clientX - startX));
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      this.storage.set(this.storageKey(), this.width());
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  }

  nudge(delta: number) {
    this.setWidth(this.width() + delta);
    this.storage.set(this.storageKey(), this.width());
  }

  private setWidth(w: number) {
    const max = window.innerWidth * 0.4;
    this.width.set(Math.round(Math.max(this.minWidth(), Math.min(w, max))));
  }
}
