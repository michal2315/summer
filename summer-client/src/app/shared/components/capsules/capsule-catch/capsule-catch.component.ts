import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { ICapsule, ISummary, ISummarySearch } from '../../../models';
import { CapsuleService } from '../../../services/capsule.service';
import { capsuleMatchesText, matchedWords, treeCapsuleIds } from '../../../utils/capsules';
import { parseQuery } from '../../../utils/search-syntax';

const MAX_WORDS = 5;

/** Where a word can be found, in the order the tooltip lists them. */
const FIELDS = [
  ['title', 'בכותרת'],
  ['content', 'בתוכן'],
  ['notes', 'בהערות'],
  ['labels', 'בתגיות'],
  ['comments', 'בתגובות'],
] as const;
type Field = (typeof FIELDS)[number][0];

const plain = (html: string) => (html ? (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '') : '');

/**
 * "Caught by #capsule": the capsules of the current search that this summary matches; the tooltip says which words
 * hit and where (title, content, notes, labels, comments).
 * Read off the same text the server searched, with the same rule.
 */
@Component({
  selector: 'app-capsule-catch',
  imports: [NzIconModule, NzToolTipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './capsule-catch.component.html',
  styleUrl: './capsule-catch.component.scss',
})
export class CapsuleCatchComponent {
  private readonly capsules = inject(CapsuleService);

  readonly summary = input.required<ISummary>();
  readonly search = input<ISummarySearch | null>(null);

  private readonly searched = computed<ICapsule[]>(() => {
    const s = this.search();
    if (!s) return [];
    const names = s.text ? parseQuery(s.text).groups.flat().flatMap((t) => (t.capsule && !t.neg ? [t.term] : [])) : [];
    const found = [...names.map((n) => this.capsules.byName(n)), ...treeCapsuleIds(s.query).map((id) => this.capsules.byId(id))];
    return found.filter((c, i): c is ICapsule => !!c && found.indexOf(c) === i);
  });

  private readonly fields = computed<Record<Field, string> | null>(() => {
    if (!this.searched().length) return null;
    const s = this.summary();
    return {
      title: s.title,
      content: plain(s.content),
      notes: plain(s.notes),
      labels: s.labels.map((l) => l.name).join('\n'),
      comments: s.comments.map((c) => c.content).join('\n'),
    };
  });

  readonly hits = computed(() => {
    const fields = this.fields();
    if (!fields) return [];
    const all = Object.values(fields).join('\n');
    return this.searched()
      .filter((c) => capsuleMatchesText(c, all))
      .map((c) => {
        const where = FIELDS.flatMap(([key, label]) => {
          const words = matchedWords(c, fields[key]);
          if (!words.length) return [];
          const more = words.length > MAX_WORDS ? ` ועוד ${words.length - MAX_WORDS}` : '';
          return [`${label}: ${words.slice(0, MAX_WORDS).join(', ')}${more}`];
        });
        return { capsule: c, tip: [`נתפס בכמוסה “${c.name}”`, ...where].join(' · ') };
      });
  });
}
