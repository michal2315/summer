import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { NzBadgeModule } from 'ng-zorro-antd/badge';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { Router } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { UserService } from '../../../core/auth/user.service';
import { CapsuleChipComponent } from '../../../shared/components/capsules/capsule-chip/capsule-chip.component';
import { CapsuleSuggestComponent } from '../../../shared/components/capsules/capsule-suggest/capsule-suggest.component';
import { ICapsule, IContentType, IQueryGroup, ISummarySearch, UserRef } from '../../../shared/models';
import { CapsuleService, capsuleSuggestions } from '../../../shared/services/capsule.service';
import { ContentTypeService } from '../../../shared/services/content-type.service';
import { SearchHistoryService, stripPaging } from '../../../shared/services/search-history.service';
import { capsuleSearchToken, treeCapsuleIds } from '../../../shared/utils/capsules';
import {
  capsuleRanges,
  deleteCapsule,
  guardEdit,
  parseQuery,
  querySegments,
  replaceShortcut,
  shortcutAt,
  snapSelection,
  typeBesideCapsule,
} from '../../../shared/utils/search-syntax';
import { EasterEggsService } from '../../../shared/easter-eggs/easter-eggs.service';
import { AltKeyDirective } from '../../../shared/keyboard/alt-key.directive';
import { AdvancedSearchComponent } from '../advanced-search/advanced-search.component';
import { countConditions } from '../advanced-search/query-tree';
import { NotificationsSettingsService } from '../../notifications/notification-rules';
import { activeFilterCount, alertSearch, describeSearch, searchToParams } from '../search-query';

const sameSearch = (a: ISummarySearch, b: ISummarySearch) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
const normalize = (s: ISummarySearch) =>
  Object.fromEntries(
    Object.entries(stripPaging(s))
      .filter(([k, v]) => k !== 'sort' && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length))
      .sort(([a], [b]) => a.localeCompare(b)),
  );

type Suggestion = { kind: 'user'; user: UserRef } | { kind: 'type'; type: IContentType } | { kind: 'capsule'; capsule: ICapsule };

/** Capsule names in the search text (`#name` terms). */
const capsuleNames = (text: string | undefined) => (text ? parseQuery(text).groups.flat().flatMap((t) => (t.capsule ? [t.term] : [])) : []);

@Component({
  selector: 'app-summary-search',
  imports: [NzBadgeModule, NzIconModule, NzTagModule, NzToolTipModule, AdvancedSearchComponent, AltKeyDirective, CapsuleChipComponent, CapsuleSuggestComponent],
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
  private readonly capsules = inject(CapsuleService);
  private readonly alerts = inject(NotificationsSettingsService);
  private readonly message = inject(NzMessageService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  /** Currently applied search (from the URL). */
  readonly search = input<ISummarySearch>({});
  readonly placeholder = input('חיפוש תמציות');
  readonly searchChange = output<ISummarySearch>();

  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('searchInput');
  private readonly mirror = viewChild.required<ElementRef<HTMLElement>>('mirror');

  readonly text = signal('');
  private readonly caret = signal(0);
  /** The caret before the last move, to know which way it travelled (capsules are skipped over as a whole). */
  private prevCaret = 0;
  readonly focused = signal(false);
  /** Escape hides the popup until the next keystroke. */
  private readonly dismissed = signal(false);
  readonly active = signal(0);
  readonly advancedOpen = signal(false);
  readonly queryCount = computed(() => {
    const q = this.search().query;
    return q ? countConditions(q) : 0;
  });

  private readonly isCapsule = (name: string) => !!this.capsules.byName(name);
  readonly segments = computed(() => querySegments(this.text(), this.isCapsule));
  /** Known capsules in the box: they behave as one unit for the caret, Backspace and Delete. */
  private readonly ranges = computed(() => capsuleRanges(this.text(), this.isCapsule));
  /** Capsules in the box, for the chips under it. */
  readonly textCapsules = computed(() => [...new Set(capsuleNames(this.text()))].flatMap((n) => this.capsules.byName(n) ?? []));
  /** The shortcut word being typed; none once the caret sits on a finished capsule. */
  readonly context = computed(() => {
    const caret = this.caret();
    if (this.ranges().some((r) => caret > r.start && caret <= r.end)) return null;
    return shortcutAt(this.text(), caret);
  });
  readonly pinned = computed(() => this.users.user()?.pinnedSearches ?? []);
  readonly recent = computed(() => this.history.recent().slice(0, 5));
  readonly filterCount = computed(() => activeFilterCount(this.search()));
  readonly isPinned = computed(() => this.pinned().some((p) => sameSearch(p, this.search())));

  private readonly userResults = signal<UserRef[]>([]);
  private readonly userQuery$ = new Subject<string>();

  private readonly capsuleQuery = computed(() => (this.popup() === 'capsule' ? this.context()!.query : null));
  private readonly capsuleList = capsuleSuggestions(this.capsuleQuery);
  readonly capsuleItems = this.capsuleList.items;
  readonly capsulesLoading = this.capsuleList.loading;

  readonly suggestions = computed<Suggestion[]>(() => {
    const ctx = this.context();
    if (ctx?.kind === 'capsule') return this.capsuleItems().map((capsule) => ({ kind: 'capsule', capsule }));
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

  /** What the popup under the box shows, if anything ('capsules': the capsules in the text, to look inside). */
  readonly popup = computed<'user' | 'type' | 'capsule' | 'capsules' | 'home' | null>(() => {
    if (!this.focused() || this.dismissed() || this.advancedOpen()) return null;
    const ctx = this.context();
    if (ctx) return ctx.kind;
    if (!this.text().trim()) return this.pinned().length || this.recent().length ? 'home' : null;
    return this.textCapsules().length ? 'capsules' : null;
  });

  constructor() {
    // The bell shows whether the applied search already has an alert.
    if (this.alerts.rules() === null) this.alerts.load();

    effect(() => {
      const s = this.search();
      untracked(() => {
        this.text.set(s.text ?? '');
        // A search from the URL or a pinned one: fetch its capsules so they show as capsules.
        this.capsules.ensure({ names: capsuleNames(s.text), ids: treeCapsuleIds(s.query) });
      });
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
    // Editing part of a capsule removes all of it; typing inside one is ignored.
    const guarded = guardEdit(this.text(), el.value, this.ranges());
    if (guarded.caret !== undefined) this.setValue(guarded.text, guarded.caret);
    this.text.set(el.value);
    this.dismissed.set(false);
    this.active.set(0);
    this.syncCaret();
  }

  /** Caret moves (clicks, arrows) change which shortcut word we're in; the mirror follows the input's scroll. */
  syncCaret() {
    const el = this.input().nativeElement;
    const a0 = el.selectionStart ?? el.value.length;
    const b0 = el.selectionEnd ?? a0;
    const [a, b] = snapSelection(this.ranges(), a0, b0, this.prevCaret);
    if (a !== a0 || b !== b0) el.setSelectionRange(a, b);
    this.prevCaret = b;
    this.caret.set(b);
    this.mirror().nativeElement.scrollLeft = el.scrollLeft;
  }

  private setValue(text: string, caret: number) {
    const el = this.input().nativeElement;
    el.value = text;
    el.setSelectionRange(caret, caret);
    this.prevCaret = caret;
  }

  /** Capsules are one unit: Backspace / Delete at their edge removes all of it, a letter typed against one gets a space. */
  private capsuleKey(e: KeyboardEvent): boolean {
    const el = this.input().nativeElement;
    const caret = el.selectionStart ?? 0;
    if (caret !== el.selectionEnd || e.ctrlKey || e.metaKey || e.altKey) return false;
    const edit =
      e.key === 'Backspace' || e.key === 'Delete'
        ? deleteCapsule(el.value, caret, e.key, this.ranges())
        : e.key.length === 1 && e.key !== ' '
          ? typeBesideCapsule(el.value, caret, e.key, this.ranges())
          : null;
    if (!edit) return false;
    e.preventDefault();
    this.setValue(edit.text, edit.caret);
    this.onInput();
    return true;
  }

  onKey(e: KeyboardEvent) {
    if (this.capsuleKey(e)) return;
    const list = this.suggestions();
    const open = this.popup() === 'user' || this.popup() === 'type' || this.popup() === 'capsule';
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

  pickCapsule(capsule: ICapsule) {
    this.pick({ kind: 'capsule', capsule });
  }

  pick(s: Suggestion) {
    const ctx = this.context();
    if (!ctx) return;
    const token = s.kind === 'user' ? `@${s.user.username}` : s.kind === 'type' ? `:${s.type.name}` : capsuleSearchToken(s.capsule);
    const next = replaceShortcut(this.text(), ctx, token);
    const el = this.input().nativeElement;
    el.value = next.text;
    el.focus();
    el.setSelectionRange(next.caret, next.caret);
    this.onInput();
  }

  submit() {
    this.eggs.onSearch(this.text());
    this.capsules.ensure({ names: capsuleNames(this.text()) });
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

  /** The alert rule for the applied search, if one exists. */
  readonly alert = computed(() => this.alerts.alertFor(this.search()));
  /** A search that selects something can become an alert. */
  readonly canAlert = computed(() => Object.keys(alertSearch(this.search())).length > 0);
  readonly alertBusy = signal(false);

  /** Bell: get notified about summaries published (or edited) later that this search finds — or stop. */
  toggleAlert() {
    if (this.alertBusy()) return;
    const existing = this.alert();
    this.alertBusy.set(true);
    const done = () => this.alertBusy.set(false);
    if (existing?._id) {
      this.alerts.delete(existing._id).subscribe({ next: () => this.message.success('ההתראה על החיפוש בוטלה'), complete: done, error: done });
    } else {
      this.alerts
        .addAlert(this.search())
        .subscribe({ next: () => this.message.success('תתקבל התראה על תמציות חדשות שמתאימות לחיפוש'), complete: done, error: done });
    }
  }

  /** Copy a link to this page with the applied search (anyone with access to the summaries sees the same results). */
  async share() {
    const path = this.router.url.split('?')[0];
    const params = Object.fromEntries(Object.entries(searchToParams(this.search())).filter(([, v]) => v !== null));
    const url = this.router.serializeUrl(this.router.createUrlTree([path], { queryParams: params }));
    try {
      await navigator.clipboard.writeText(new URL(this.location.prepareExternalUrl(url), window.location.origin).href);
      this.message.success('הקישור לחיפוש הועתק');
    } catch {
      this.message.error('ההעתקה נכשלה');
    }
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

  readonly describe = describeSearch;

  /** "/" anywhere focuses the search input. */
  onGlobalKey(e: KeyboardEvent) {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, [contenteditable="true"], .ql-editor')) return;
    e.preventDefault();
    this.input().nativeElement.focus();
  }
}
