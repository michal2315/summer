import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, inject, input, signal } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';

const CURRENT = 'highlight-current';

/**
 * Find-in-page for search hits: how many `.highlight`s the surrounding `root` element holds, and ↑ / ↓ to scroll from
 * one to the next (the current one is marked). Recounts whenever the content re-renders. Hidden when there are none.
 */
@Component({
  selector: 'app-match-nav',
  imports: [NzIconModule, NzToolTipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './match-nav.component.html',
  styleUrl: './match-nav.component.scss',
})
export class MatchNavComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** CSS selector of the ancestor whose hits are counted. */
  readonly root = input.required<string>();

  readonly count = signal(0);
  /** -1 until the user steps to a hit. */
  readonly index = signal(-1);
  private container?: HTMLElement;

  constructor() {
    const observer = new MutationObserver(() => this.recount());
    afterNextRender(() => {
      this.container = this.host.nativeElement.closest<HTMLElement>(this.root()) ?? undefined;
      if (!this.container) return;
      observer.observe(this.container, { childList: true, subtree: true, characterData: true });
      this.recount();
    });
    inject(DestroyRef).onDestroy(() => observer.disconnect());
  }

  /** ↓ = next (+1), ↑ = previous (-1), wrapping around. */
  step(by: 1 | -1) {
    const hits = this.hits();
    if (!hits.length) return;
    const i = this.index() < 0 ? (by > 0 ? 0 : hits.length - 1) : (this.index() + by + hits.length) % hits.length;
    hits.forEach((h) => h.classList.remove(CURRENT));
    hits[i].classList.add(CURRENT);
    hits[i].scrollIntoView({ block: 'center', behavior: 'smooth' });
    this.index.set(i);
  }

  private hits(): HTMLElement[] {
    return this.container ? Array.from(this.container.querySelectorAll<HTMLElement>('.highlight')) : [];
  }

  private recount() {
    const n = this.hits().length;
    if (n !== this.count()) {
      this.count.set(n);
      this.index.set(-1);
    }
  }
}
