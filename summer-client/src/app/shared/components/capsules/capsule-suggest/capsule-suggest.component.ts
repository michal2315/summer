import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, output } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { ICapsule } from '../../../models';
import { normalizeCapsuleName, wordsOf } from '../../../utils/capsules';
import { SkeletonComponent } from '../../skeleton/skeleton.component';

const PREVIEW_WORDS = 4;

/**
 * Capsules matching what was typed after `#`: name (the typed part marked), a preview of the words, the word count.
 * The owner keeps the list and the active row so its input's arrow keys and Enter drive it.
 */
@Component({
  selector: 'app-capsule-suggest',
  imports: [NzIconModule, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './capsule-suggest.component.html',
  styleUrl: './capsule-suggest.component.scss',
  host: { role: 'listbox', 'aria-label': 'כמוסות', '(mousedown)': '$event.preventDefault()' },
})
export class CapsuleSuggestComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly query = input('');
  readonly items = input<ICapsule[]>([]);
  readonly loading = input(false);
  readonly active = input(0);
  readonly activeChange = output<number>();
  readonly picked = output<ICapsule>();

  constructor() {
    // Keyboard moves keep the active row in view.
    effect(() => {
      const i = this.active();
      queueMicrotask(() => this.host.nativeElement.querySelectorAll('.row')[i]?.scrollIntoView({ block: 'nearest' }));
    });
  }

  /** The name split around the typed text: [before, match, after]. */
  parts(name: string): [string, string, string] {
    const q = normalizeCapsuleName(this.query());
    const i = q ? name.toLowerCase().indexOf(q) : -1;
    return i < 0 ? [name, '', ''] : [name.slice(0, i), name.slice(i, i + q.length), name.slice(i + q.length)];
  }

  preview(c: ICapsule): { must: string[]; optional: string[]; not: string[]; more: number } {
    const must = wordsOf(c, 'must').slice(0, PREVIEW_WORDS);
    const optional = wordsOf(c, 'optional').slice(0, PREVIEW_WORDS - must.length);
    const not = wordsOf(c, 'mustNot').slice(0, Math.max(1, PREVIEW_WORDS - must.length - optional.length));
    return { must, optional, not, more: c.words.length - must.length - optional.length - not.length };
  }
}
