import { DestroyRef, Directive, ElementRef, effect, inject, input, output, untracked } from '@angular/core';

/**
 * Emits when the host scrolls into view. Put it on a sentinel after the last list item for infinite scroll, and bind
 * `appInViewKey` to the rendered count: when it changes the sentinel is checked again, so a page too short to push it
 * out of view still loads the next one.
 */
@Directive({ selector: '[appInView]' })
export class InViewDirective {
  private readonly el = inject(ElementRef<HTMLElement>);
  private observer?: IntersectionObserver;

  readonly rootMargin = input('300px');
  readonly appInViewKey = input<unknown>();
  readonly appInView = output<void>();

  constructor() {
    effect(() => {
      const rootMargin = this.rootMargin();
      this.appInViewKey();
      // A fresh observer reports the current state right away, so a sentinel still in view emits again.
      untracked(() => {
        this.observer?.disconnect();
        this.observer = new IntersectionObserver(
          (entries) => {
            if (entries.some((e) => e.isIntersecting)) this.appInView.emit();
          },
          { rootMargin },
        );
        this.observer.observe(this.el.nativeElement);
      });
    });
    inject(DestroyRef).onDestroy(() => this.observer?.disconnect());
  }
}
