import { ChangeDetectionStrategy, Component, OnDestroy, effect, input, output } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { Observable } from 'rxjs';

/** A toast's content; `undo` puts the action back (no undo: just a notice). */
export interface UndoToast {
  text: string;
  undo?: () => Observable<unknown>;
  /** how long it stays (ms); hovering keeps it up */
  ms: number;
}

/**
 * "Moved x to y" with an undo button, floating at the bottom middle of the page (the side-nav tree's toast look).
 * Closes itself after `toast.ms`; the parent clears its signal on `closed`.
 */
@Component({
  selector: 'app-undo-toast',
  imports: [NzIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './undo-toast.component.html',
  styleUrl: './undo-toast.component.scss',
  host: { role: 'status', '(mouseenter)': 'pause()', '(mouseleave)': 'resume()' },
})
export class UndoToastComponent implements OnDestroy {
  readonly toast = input.required<UndoToast>();
  readonly undo = output<void>();
  readonly closed = output<void>();
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    // A new toast replacing this one gets its full time.
    effect(() => {
      this.toast();
      this.resume();
    });
  }

  pause() {
    clearTimeout(this.timer);
  }

  resume() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.closed.emit(), this.toast().ms);
  }

  ngOnDestroy() {
    clearTimeout(this.timer);
  }
}
