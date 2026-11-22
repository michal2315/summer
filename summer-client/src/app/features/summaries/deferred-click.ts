/** How long a click waits to see whether it is the first half of a double-click. */
const DOUBLE_CLICK_WAIT = 250;

/**
 * Holds back a single click's action until it is clear no double-click follows, so a double-click doesn't also run it.
 */
export class DeferredClick {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private action: (() => void) | undefined;

  /** A new click first runs any still-pending one (quick clicks on different rows each count). */
  run(action: () => void) {
    const previous = this.action;
    this.cancel();
    previous?.();
    this.action = action;
    this.timer = setTimeout(() => {
      this.timer = this.action = undefined;
      action();
    }, DOUBLE_CLICK_WAIT);
  }

  /** Drops the pending action; false when there was none (it already ran, for a slower double-click). */
  cancel(): boolean {
    if (this.timer === undefined) return false;
    clearTimeout(this.timer);
    this.timer = this.action = undefined;
    return true;
  }
}
