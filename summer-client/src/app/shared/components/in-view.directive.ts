import { Directive, ElementRef, OnDestroy, OnInit, inject, input, output } from '@angular/core';

/** Emits when the host scrolls into view. Put it on a sentinel after the last list item for infinite scroll. */
@Directive({ selector: '[appInView]' })
export class InViewDirective implements OnInit, OnDestroy {
  private readonly el = inject(ElementRef<HTMLElement>);
  private observer?: IntersectionObserver;

  readonly rootMargin = input('300px');
  readonly appInView = output<void>();

  ngOnInit() {
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) this.appInView.emit();
      },
      { rootMargin: this.rootMargin() },
    );
    this.observer.observe(this.el.nativeElement);
  }

  ngOnDestroy() {
    this.observer?.disconnect();
  }
}
