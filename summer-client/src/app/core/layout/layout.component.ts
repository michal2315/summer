import { ChangeDetectionStrategy, Component, afterNextRender, inject, signal } from '@angular/core';
import { WhatsNewService } from '../../shared/components/whats-new';
import { TourService } from '../../shared/tour/tour.service';
import { RouterOutlet } from '@angular/router';
import { NzLayoutModule } from 'ng-zorro-antd/layout';
import { StorageService } from '../storage/storage.service';
import { SideNavComponent } from './side-nav/side-nav.component';

const WIDTH_KEY = 'sideNavWidth';
const MIN_WIDTH = 220;
const DEFAULT_WIDTH = 280;

@Component({
  selector: 'app-layout',
  imports: [NzLayoutModule, RouterOutlet, SideNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './layout.component.html',
  styleUrl: './layout.component.scss',
})
export class LayoutComponent {
  private readonly storage = inject(StorageService);
  readonly collapsed = signal(false);
  /** Side nav width (drag the handle; persisted). */
  readonly width = signal(DEFAULT_WIDTH);

  constructor() {
    this.setWidth(this.storage.get<number>(WIDTH_KEY) ?? DEFAULT_WIDTH);
    const whatsNew = inject(WhatsNewService);
    const tour = inject(TourService);
    // First visit gets the basics tour instead of the release notes; those wait for the next session.
    afterNextRender(() => setTimeout(() => tour.greet() || whatsNew.showIfUnseen(), 700));
  }

  /** On narrow screens the sider overlays content — close it after a nav click. */
  onNavigate() {
    if (window.innerWidth < 992) this.collapsed.set(true);
  }

  startDrag(e: PointerEvent) {
    const handle = e.target as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = this.width();
    // RTL: the nav is on the right, so dragging the handle left (smaller clientX) widens it.
    const move = (ev: PointerEvent) => this.setWidth(startW + (startX - ev.clientX));
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      this.storage.set(WIDTH_KEY, this.width());
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  }

  nudge(delta: number) {
    this.setWidth(this.width() + delta);
    this.storage.set(WIDTH_KEY, this.width());
  }

  private setWidth(w: number) {
    // Leaves the list and the summary side panel room to sit beside it.
    const max = Math.max(MIN_WIDTH, Math.min(window.innerWidth * 0.3, 480));
    this.width.set(Math.round(Math.max(MIN_WIDTH, Math.min(w, max))));
  }
}
