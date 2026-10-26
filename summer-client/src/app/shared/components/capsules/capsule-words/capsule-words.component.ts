import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { ICapsule } from '../../../models';
import { CONDITIONS, wordsOf } from '../../../utils/capsules';

/** Long capsules get a filter box. */
const FILTER_FROM = 12;

/** A capsule's words grouped by condition (must / optional / mustNot), with a filter for long capsules. */
@Component({
  selector: 'app-capsule-words',
  imports: [NzIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './capsule-words.component.html',
  styleUrl: './capsule-words.component.scss',
})
export class CapsuleWordsComponent {
  readonly capsule = input.required<ICapsule>();

  readonly filter = signal('');
  readonly filterable = computed(() => this.capsule().words.length > FILTER_FROM);

  readonly groups = computed(() => {
    const c = this.capsule();
    const f = this.filter().trim().toLowerCase();
    const hasMust = wordsOf(c, 'must').length > 0;
    return CONDITIONS.map((cond) => ({
      ...cond,
      // With must words present, optional words don't filter — they are only highlighted.
      hint: cond.key === 'optional' && hasMust ? 'לא חובה, רק מודגשות בתוצאות' : cond.hint,
      words: wordsOf(c, cond.key).filter((w) => !f || w.toLowerCase().includes(f)),
    })).filter((g) => g.words.length);
  });
}
