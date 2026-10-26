import { Directive, ElementRef, computed, effect, inject, input } from '@angular/core';
import { ALT_KEYS, AltKeyId } from './alt-keys';
import { AltKeysService } from './alt-keys.service';

/** Binds an Alt shortcut from ALT_KEYS to this element: Alt+key clicks it (or focuses it, for inputs). */
@Directive({
  selector: '[appAltKey]',
  host: { '[attr.aria-keyshortcuts]': 'shortcut()' },
})
export class AltKeyDirective {
  readonly appAltKey = input.required<AltKeyId>();
  readonly shortcut = computed(() => `Alt+${ALT_KEYS[this.appAltKey()].key}`);

  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const keys = inject(AltKeysService);
    effect((onCleanup) => onCleanup(keys.register(el, this.appAltKey())));
  }
}
