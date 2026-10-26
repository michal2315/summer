import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { SummyComponent } from '../summy/summy.component';
import { LOADING_QUIPS } from './loading-quips';

const INTERVAL_MS = 1800;

/** One rotating, playful line under a loading skeleton — a new one every couple of seconds, never the same twice in a row. */
@Component({
  selector: 'app-loading-quip',
  imports: [SummyComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Decorative: a live region would announce a new quip every couple of seconds. Lists already set aria-busy.
  host: { 'aria-hidden': 'true' },
  templateUrl: './loading-quip.component.html',
  styleUrl: './loading-quip.component.scss',
})
export class LoadingQuipComponent {
  readonly quip = signal(pick());

  constructor() {
    const timer = setInterval(() => this.quip.set(pick(this.quip())), INTERVAL_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
}

function pick(previous?: string): string {
  const options = LOADING_QUIPS.filter((q) => q !== previous);
  return options[Math.floor(Math.random() * options.length)];
}
