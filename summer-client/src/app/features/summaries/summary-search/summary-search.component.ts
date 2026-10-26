import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { NzBadgeModule } from 'ng-zorro-antd/badge';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { Subject, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { UserService } from '../../../core/auth/user.service';
import { IContentType, IQueryGroup, ISummarySearch, UserRef } from '../../../shared/models';
import { ContentTypeService } from '../../../shared/services/content-type.service';
import { SearchHistoryService, stripPaging } from '../../../shared/services/search-history.service';
import { querySegments, replaceShortcut, shortcutAt } from '../../../shared/utils/search-syntax';
import { EasterEggsService } from '../../../shared/easter-eggs/easter-eggs.service';
import { AltKeyDirective } from '../../../shared/keyboard/alt-key.directive';
import { AdvancedSearchComponent } from '../advanced-search/advanced-search.component';
import { countConditions } from '../advanced-search/query-tree';
import { activeFilterCount } from '../search-query';

const sameSearch = (a: ISummarySearch, b: ISummarySearch) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
const normalize = (s: ISummarySearch) =>
  Object.fromEntries(
    Object.entries(stripPaging(s))
      .filter(([k, v]) => k !== 'sort' && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length))
      .sort(([a], [b]) => a.localeCompare(b)),
  );

/** Cheat-sheet shown when the empty box is focused. */
const SHORTCUTS: { example: string; hint: string; insert?: string }[] = [
  { example: 'גרף וגם עץ', hint: 'שתי המילים (and)' },
  { example: 'גרף או עץ', hint: 'אחת מהמילים (or)' },
  { example: 'גרף לא מכוון', hint: 'בלי המילה (not)' },
  { example: '@משתמש', hint: 'תמציות של משתמש', insert: '@' },
  { example: ':שיעור', hint: 'סוג תוכן', insert: ':' },
  { example: '"ביטוי מדויק"', hint: 'ביטוי שלם' },
];

type Suggestion = { kind: 'user'; user: UserRef } | { kind: 'type'; type: IContentType };

@Component({
  selector: 'app-summary-search',
  imports: [NzBadgeModule, NzIconModule, NzTagModule, NzToolTipModule, AdvancedSearchComponent, AltKeyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './summary-search.component.html',
  styleUrl: './summary-search.component.scss',
  host: {
    '(document:keydown)': 'onGlobalKey($event)',
    '(keydown.escape)': 'advancedOpen.set(false)',
  },
})
export class SummarySearchComponent {
  private readonly users = inject(UserService);
  private readonly contentTypes = inject(ContentTypeService);
  private readonly history = inject(SearchHistoryService);
  private readonly eggs = inject(EasterEggsService);

  /** Currently applied search (from the URL). */
  readonly search = input<ISummarySearch>({});
  readonly placeholder = input('חיפוש תמציות');
  readonly searchChange = output<ISummarySearch>();

  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('searchInput');
  private readonly mirror = viewChild.required<ElementRef<HTMLElement>>('mirror');

  readonly shortcuts = SHORTCUTS;
  readonly segmentsOf = querySegments;
  readonly text = signal('');
  private readonly caret = signal(0);
  readonly focused = signal(false);
  /** Escape hides the popup until the next keystroke. */
  private readonly dismissed = signal(false);
  readonly active = signal(0);
  readonly advancedOpen = signal(false);
  readonly queryCount = computed(() => {
    const q = this.search().query;
    return q ? countConditions(q) : 0;
  });

  readonly segments = computed(() => querySegments(this.text()));
  readonly context = computed(() => shortcutAt(this.text(), this.caret()));
  readonly pinned = computed(() => this.users.user()?.pinnedSearches ?? []);
  readonly recent = computed(() => this.history.recent().slice(0, 5));
  readonly filterCount = computed(() => activeFilterCount(this.search()));
  readonly isPinned = computed(() => this.pinned().some((p) => sameSearch(p, this.search())));

  private readonly userResults = signal<UserRef[]>([]);
  private readonly userQuery$ = new Subject<string>();

  readonly suggestions = computed<Suggestion[]>(() => {
    const ctx = this.context();
    if (ctx?.kind === 'user') return this.userResults().map((user) => ({ kind: 'user', user }));
    if (ctx?.kind === 'type') {
      const q = ctx.query.replace(/_/g, ' ').toLowerCase();
      return this.contentTypes
        .list()
        .filter((t) => !q || t.name.toLowerCase().startsWith(q) || t.displayName.toLowerCase().includes(q))
        .map((type) => ({ kind: 'type', type }));
    }
    return [];
  });

  /** What the popup under the box shows, if anything. */
  readonly popup = computed<'user' | 'type' | 'home' | null>(() => {
    if (!this.focused() || this.dismissed() || this.advancedOpen()) return null;
    const ctx = this.context();
    if (ctx) return ctx.kind;
    return this.text().trim() ? null : 'home';
  });

  constructor() {
    effect(() => {
      const t = this.search().text ?? '';
      untracked(() => this.text.set(t));
    });

    this.userQuery$
      .pipe(
        debounceTime(200),
        distinctUntilChanged(),
        switchMap((q) => (q ? this.users.byName(q) : of([]))),
      )
      .subscribe((list) => {
        this.userResults.set(list.filter((u) => !u.isSystem).slice(0, 8));
        this.active.set(0);
      });

    effect(() => {
      const ctx = this.context();
      if (ctx?.kind === 'user') this.userQuery$.next(ctx.query.replace(/_/g, ' '));
    });
  }

  onInput() {
    const el = this.input().nativeElement;
    this.text.set(el.value);
    this.dismissed.set(false);
    this.active.set(0);
    this.syncCaret();
  }

  /** Caret moves (clicks, arrows) change which shortcut word we're in; the mirror follows the input's scroll. */
  syncCaret() {
    const el = this.input().nativeElement;
    this.caret.set(el.selectionStart ?? el.value.length);
    this.mirror().nativeElement.scrollLeft = el.scrollLeft;
  }

  onKey(e: KeyboardEvent) {
    const list = this.suggestions();
    const open = this.popup() === 'user' || this.popup() === 'type';
    if (e.key === 'Escape') {
      if (this.popup()) this.dismissed.set(true);
      else this.input().nativeElement.blur();
    } else if (open && list.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      this.active.update((i) => (i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length);
    } else if (open && list.length && (e.key === 'Enter' || e.key === 'Tab')) {
      e.preventDefault();
      this.pick(list[Math.min(this.active(), list.length - 1)]);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.submit();
    }
  }

  pick(s: Suggestion) {
    const ctx = this.context();
    if (!ctx) return;
    const token = s.kind === 'user' ? `@${s.user.username}` : `:${s.type.name}`;
    const next = replaceShortcut(this.text(), ctx, token);
    const el = this.input().nativeElement;
    el.value = next.text;
    el.focus();
    el.setSelectionRange(next.caret, next.caret);
    this.onInput();
  }

  submit() {
    this.eggs.onSearch(this.text());
    this.apply({ ...this.search(), text: this.text().trim() || undefined });
    this.input().nativeElement.blur();
  }

  runAdvanced(query: IQueryGroup | undefined) {
    this.advancedOpen.set(false);
    this.apply({ ...this.search(), text: this.text().trim() || undefined, query });
  }

  apply(s: ISummarySearch) {
    this.history.add(s);
    this.searchChange.emit({ ...s, sort: this.search().sort });
  }

  clear() {
    this.text.set('');
    this.searchChange.emit({ sort: this.search().sort });
  }

  togglePin() {
    this.users.pinSearch(stripPaging(this.search()), !this.isPinned()).subscribe();
  }

  unpin(s: ISummarySearch, event: Event) {
    // Let the refreshed user.pinnedSearches drive removal instead of nz-tag removing its own DOM.
    event.preventDefault();
    event.stopPropagation();
    this.users.pinSearch(s, false).subscribe();
  }

  /** Start a @ / : shortcut from the cheat-sheet, opening its suggestions. */
  startShortcut(sigil: string) {
    const el = this.input().nativeElement;
    el.value = sigil;
    el.focus();
    el.setSelectionRange(1, 1);
    this.onInput();
  }

  describe(s: ISummarySearch): string {
    const conditions = s.query ? countConditions(s.query) : 0;
    const parts = [
      s.text,
      conditions ? `${conditions} תנאים מתקדמים` : '',
      s.contentTypes?.length ? `${s.contentTypes.length} סוגי תוכן` : '',
      s.colors?.length ? 'צבעים' : '',
    ].filter(Boolean);
    return parts.join(' · ') || 'חיפוש ללא טקסט';
  }

  /** "/" anywhere focuses the search input. */
  onGlobalKey(e: KeyboardEvent) {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, [contenteditable="true"], .ql-editor')) return;
    e.preventDefault();
    this.input().nativeElement.focus();
  }
}
