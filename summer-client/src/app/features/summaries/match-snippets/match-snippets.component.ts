import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ISummary, ISummarySearch, SearchType } from '../../../shared/models';
import { matchSnippet, regexFor } from '../../../shared/pipes/highlight';
import { CapsuleService } from '../../../shared/services/capsule.service';

/** About how much of the content the card's two-line preview shows; a first hit further in gets a snippet. */
const PREVIEW_CHARS = 110;
const MAX_ROWS = 3;

/** Quill HTML → one line of text (blocks separated by spaces, so words don't run together). */
const plain = (html: string) =>
  html ? (new DOMParser().parseFromString(html.replace(/<\/(p|div|li|h[1-6]|blockquote|pre)>|<br\s*\/?>/gi, '$& '), 'text/html').body.textContent ?? '').replace(/\s+/g, ' ').trim() : '';

interface Row {
  where: string;
  html: string;
}

/**
 * "Found in": for search hits the card doesn't show (further into the content, notes, comments, labels past the
 * visible ones), the first hit with some words around it, highlighted. Empty when there's no search or no hidden hit.
 */
@Component({
  selector: 'app-match-snippets',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './match-snippets.component.html',
  styleUrl: './match-snippets.component.scss',
})
export class MatchSnippetsComponent {
  private readonly capsules = inject(CapsuleService);

  readonly summary = input.required<ISummary>();
  readonly search = input<ISummarySearch | null>(null);
  /** Labels the card already shows. */
  readonly visibleLabels = input(0);

  readonly rows = computed<Row[]>(() => {
    const search = this.search();
    if (!search) return [];
    const s = this.summary();
    const re = (type: SearchType) => regexFor(search, type, this.capsules);
    const rows: Row[] = [];
    const add = (where: string, html: string | null) => html && rows.push({ where, html });

    const contentRe = re(SearchType.Content);
    const content = plain(s.content);
    if (contentRe) {
      contentRe.lastIndex = 0;
      const first = contentRe.exec(content);
      contentRe.lastIndex = 0;
      if (first && first.index > PREVIEW_CHARS) add('בהמשך התמצית', matchSnippet(content, contentRe));
    }
    add('הערות', matchSnippet(plain(s.notes), re(SearchType.Notes)));
    const commentsRe = re(SearchType.Comments);
    for (const c of s.comments) {
      const html = matchSnippet(c.content, commentsRe);
      if (html) {
        add(`תגובה של ${c.user?.fullName ?? 'משתמש'}`, html);
        break;
      }
    }
    const hidden = s.labels.slice(this.visibleLabels()).map((l) => l.name);
    add('תגית', matchSnippet(hidden.join(' · '), re(SearchType.Label), 0, 30));
    return rows.slice(0, MAX_ROWS);
  });
}
