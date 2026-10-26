import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, input, signal } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { AltKeysService } from '../../keyboard/alt-keys.service';
import { TourService } from '../tour.service';

const GAP = 12;
const EDGE = 8;

/** The "סיור ועזרה" panel: basics, what's new, and every advanced topic. Opens beside its anchor button. */
@Component({
  selector: 'app-tour-hub',
  imports: [NzIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tour-hub.component.html',
  styleUrl: './tour-hub.component.scss',
  host: { role: 'dialog', 'aria-label': 'סיור ועזרה', '[style.top.px]': 'top()', '[style.left.px]': 'left()', '[class.placed]': 'top() !== null' },
})
export class TourHubComponent {
  readonly tour = inject(TourService);
  private readonly altKeys = inject(AltKeysService);
  readonly anchor = input.required<HTMLElement>();

  readonly top = signal<number | null>(null);
  readonly left = signal<number | null>(null);

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => {
      // Beside the anchor (toward the page), bottoms aligned; centered when there is no room (narrow screens).
      const r = this.anchor().getBoundingClientRect();
      const w = host.offsetWidth;
      const h = host.offsetHeight;
      let left = r.left - GAP - w;
      if (left < EDGE) left = r.right + GAP + w < innerWidth - EDGE ? r.right + GAP : (innerWidth - w) / 2;
      this.left.set(Math.max(EDGE, left));
      this.top.set(Math.max(EDGE, Math.min(innerHeight - h - EDGE, r.bottom - h)));
      host.querySelector<HTMLElement>('.core')?.focus({ preventScroll: true });
    });
  }

  showShortcuts() {
    this.tour.closeHub();
    this.altKeys.toggleHelp(true);
  }
}
