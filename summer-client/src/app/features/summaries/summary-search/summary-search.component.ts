import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzBadgeModule } from 'ng-zorro-antd/badge';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzPopoverModule } from 'ng-zorro-antd/popover';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { Router } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { UserService } from '../../../core/auth/user.service';
import { NotificationBellComponent } from '../../../shared/components/notification-bell/notification-bell.component';
import { PreferencesButtonComponent } from '../../../shared/components/preferences/preferences-button.component';
import { CapsuleChipComponent } from '../../../shared/components/capsules/capsule-chip/capsule-chip.component';
import { CapsuleSuggestComponent } from '../../../shared/components/capsules/capsule-suggest/capsule-suggest.component';
import { ICapsule, IContentType, IQuery, IQueryGroup, ISummarySearch, UserRef } from '../../../shared/models';
import { CapsuleService, capsuleSuggestions } from '../../../shared/services/capsule.service';
import { ContentTypeService } from '../../../shared/services/content-type.service';
import { QueryService } from '../../../shared/services/query.service';
import { SearchHistoryService, stripPaging } from '../../../shared/services/search-history.service';
import { capsuleSearchToken, treeCapsuleIds } from '../../../shared/utils/capsules';
import {
  COLOR_NAMES,
  MARK,
  SEARCH_FIELDS,
  SearchField,
  capsuleRanges,
  cleanMarks,
  deleteCapsule,
  guardEdit,
  markHeads,
  markTyped,
  parseQuery,
  querySegments,
  replaceShortcut,
  shortcutAt,
  snapSelection,
  typeBesideCapsule,
  unmarkBefore,
} from '../../../shared/utils/search-syntax';
import { LabelService } from '../../../shared/services/label.service';
import { EasterEggsService } from '../../../shared/easter-eggs/easter-eggs.service';
import { AltKeyDirective } from '../../../shared/keyboard/alt-key.directive';
import { AdvancedSearchComponent } from '../advanced-search/advanced-search.component';
import { countConditions } from '../advanced-search/query-tree';
import { QUERY_KIND_LABEL, activeFilterCount, alertSearch, describeSearch, searchToParams } from '../search-query';

/** How many saved searches the box suggests while typing. */
const QUERY_MATCHES = 5;
/** Typed text as plain words (syntax marks dropped), to find saved searches by name. */
const plainWords = (text: string) =>
  text
    .replaceAll(MARK, '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

const M = MARK;

/** Cheat-sheet in the popover over the "/" key. */
const SHORTCUTS: { example: string; hint: string }[] = [
  { example: `גרף ${M}וגם עץ`, hint: 'שתי המילים (וגם / גם / and)' },
  { example: `גרף ${M}או עץ`, hint: 'אחת מהמילים (או / or)' },
  { example: `גרף ${M}לא מכוון`, hint: 'בלי המילה (לא / ולא / בלי / ובלי / not)' },
  { example: 'מבוא', hint: 'כל מקום שהמילה מופיעה בו, גם כחלק ממילה' },
  { example: '"מבוא"', hint: 'התאמה מדויקת: מילה או ביטוי שלמים' },
  { example: `${M}@משתמש`, hint: 'תמציות של משתמש' },
  { example: `${M}:כותרת:מבוא_לביולוגיה`, hint: 'חיפוש בשדה (_ במקום רווח; רווח מסיים את השדה)' },
  { example: `${M}:סוג:שיעור`, hint: 'גם כותב, תווית, צבע, תוכן, הערות, תגובות' },
  { example: `${M}:כותרת:"מבוא לביולוגיה"`, hint: 'בתוך שדה: "מירכאות" להתאמה מדויקת' },
  { example: `${M}#כמוסה`, hint: 'כמוסה: קבוצת מילים שמורה' },
  { example: `${M}#שם_עם_רווחים`, hint: '_ במקום רווח בשמות כמוסות' },
  { example: `${M}$חיפוש_שמור`, hint: 'הרצת חיפוש שמור (בחירה מהרשימה) — רק לבד בתיבה' },
  { example: 'Backspace', hint: 'מיד אחרי אופרטור או סימן: מבטל אותו, והוא נחפש כטקסט רגיל' },
  { example: '/', hint: 'מעבר לתיבת החיפוש מכל מקום' },
  { example: '↑ ↓ Enter', hint: 'בחירה מההצעות (גם Tab)' },
  { example: 'Esc', hint: 'סגירת ההצעות' },
];

type Suggestion =
  | { kind: 'user'; user: UserRef }
  | { kind: 'type'; type: IContentType }
  | { kind: 'capsule'; capsule: ICapsule }
  | { kind: 'field'; field: SearchField }
  | { kind: 'color'; name: string; hex: string }
  | { kind: 'label'; label: string }
  | { kind: 'saved'; saved: IQuery };

/** Capsule names in the search text (`#name` terms). */
const capsuleNames = (text: string | undefined) => (text ? parseQuery(text).groups.flat().flatMap((t) => (t.capsule ? [t.term] : [])) : []);

@Component({
  selector: 'app-summary-search',
  imports: [
    FormsModule,
    NzBadgeModule,
    NzButtonModule,
    NzIconModule,
    NzInputModule,
    NzPopoverModule,
    NzTagModule,
    NzToolTipModule,
    AdvancedSearchComponent, AltKeyDirective, CapsuleChipComponent, CapsuleSuggestComponent, NotificationBellComponent, PreferencesButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './summary-search.component.html',
  styleUrl: './summary-search.component.scss',
  host: {
    '(document:keydown)': 'onGlobalKey($event)',
    '(keydown.escape)': 'toggleAdvanced(false)',
  },
})
export class SummarySearchComponent {
  private readonly users = inject(UserService);
  private readonly contentTypes = inject(ContentTypeService);
  private readonly history = inject(SearchHistoryService);
  private readonly eggs = inject(EasterEggsService);
  private readonly capsules = inject(CapsuleService);
  private readonly labels = inject(LabelService);
  private readonly queries = inject(QueryService);
  private readonly message = inject(NzMessageService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  /** Currently applied search (from the URL). */
  readonly search = input<ISummarySearch>({});
  readonly showBell = input(true);
  /** Pin (save), share and alert buttons; off where the search is being edited rather than run (a search alert's rule). */
  readonly searchActions = input(true);
  readonly placeholder = input('חיפוש תמציות');
  /** The advanced-search button; off where only the text is edited (a simple saved search). */
  readonly advancedSearch = input(true);
  readonly searchChange = output<ISummarySearch>();
  /** The text as it is typed (before Enter), for forms that save it. */
  readonly textInput = output<string>();

  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('searchInput');
  private readonly mirror = viewChild.required<ElementRef<HTMLElement>>('mirror');

  readonly shortcuts = SHORTCUTS;
  readonly segmentsOf = querySegments;
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
  /** Plus the invisible mark before each marked token, which the caret skips. */
  private readonly snapRanges = computed(() => [...this.ranges(), ...markHeads(this.text())]);
  /** Capsules in the box, for the chips under it. */
  readonly textCapsules = computed(() => [...new Set(capsuleNames(this.text()))].flatMap((n) => this.capsules.byName(n) ?? []));
  /** The shortcut word being typed; none once the caret sits on a finished capsule. */
  readonly context = computed(() => {
    const caret = this.caret();
    if (this.ranges().some((r) => caret > r.start && caret <= r.end)) return null;
    return shortcutAt(this.text(), caret);
  });
  /** A marked shortcut: its suggestions show. */
  readonly live = computed(() => {
    const ctx = this.context();
    return ctx?.marked ? ctx : null;
  });
  readonly saved = this.queries.queries;
  readonly recent = computed(() => this.history.recent().slice(0, 5));
  readonly filterCount = computed(() => activeFilterCount(this.search()));
  /** The saved search the applied search matches, if any. */
  readonly savedMatch = computed(() => this.queries.matching(this.search()));
  /** The saved search shown as a pill in the box: the applied search is one, and its text hasn't been edited since. */
  readonly savedPill = computed(() => {
    const saved = this.searchActions() ? this.savedMatch() : undefined;
    return saved && this.text().trim() === (this.search().text ?? '').trim() ? saved : undefined;
  });
  readonly saveOpen = signal(false);
  readonly saveName = signal('');
  readonly saveBusy = signal(false);

  private readonly userResults = signal<UserRef[]>([]);
  private readonly userQuery$ = new Subject<string>();
  private readonly labelResults = signal<string[]>([]);
  private readonly labelQuery$ = new Subject<string>();

  private readonly capsuleQuery = computed(() => (this.popup() === 'capsule' ? this.context()!.query : null));
  private readonly capsuleList = capsuleSuggestions(this.capsuleQuery);
  readonly capsuleItems = this.capsuleList.items;
  readonly capsulesLoading = this.capsuleList.loading;

  readonly suggestions = computed<Suggestion[]>(() => {
    const ctx = this.live();
    if (!ctx) return [];
    const q = ctx.query.replace(/_/g, ' ').toLowerCase();
    if (ctx.kind === 'capsule') return this.capsuleItems().map((capsule) => ({ kind: 'capsule', capsule }));
    if (ctx.kind === 'saved')
      return this.saved()
        .filter((saved) => !q || saved.name.toLowerCase().includes(q))
        .slice(0, 8)
        .map((saved) => ({ kind: 'saved', saved }));
    if (ctx.kind === 'user') return this.userResults().map((user) => ({ kind: 'user', user }));
    if (ctx.kind === 'field')
      return SEARCH_FIELDS.filter((f) => !q || f.name.includes(q) || f.label.includes(q) || f.aliases.some((a) => a.startsWith(q))).map((field) => ({
        kind: 'field',
        field,
      }));
    switch (ctx.field!.values) {
      case 'users':
        return this.userResults().map((user) => ({ kind: 'user', user }));
      case 'types':
        return this.contentTypes
          .list()
          .filter((t) => !q || t.name.toLowerCase().startsWith(q) || t.displayName.toLowerCase().includes(q))
          .map((type) => ({ kind: 'type', type }));
      case 'colors':
        return COLOR_NAMES.filter((c) => !q || c.name.includes(q)).map((c) => ({ kind: 'color', ...c }));
      case 'labels':
        return this.labelResults().map((label) => ({ kind: 'label', label }));
      default:
        return [];
    }
  });

  /**
   * Saved searches whose name has every typed word, while plain text is typed (no shortcut being written). The text
   * already applied doesn't suggest anything (it was just searched).
   */
  readonly queryMatches = computed<IQuery[]>(() => {
    const text = this.text();
    if (this.live() || text.trim() === (this.search().text ?? '').trim()) return [];
    const words = plainWords(text);
    if (!words.length) return [];
    return this.saved()
      .filter((q) => {
        const name = q.name.toLowerCase();
        return words.every((w) => name.includes(w));
      })
      .slice(0, QUERY_MATCHES);
  });
  /** The highlighted match (↓ / ↑); -1: none, so Enter searches the typed text. */
  readonly queryActive = signal(-1);

  /** What the popup under the box shows, if anything ('capsules': the capsules in the text, to look inside). */
  readonly popup = computed<'blocked' | 'user' | 'field' | 'value' | 'capsule' | 'saved' | 'queries' | 'capsules' | 'home' | null>(() => {
    if (!this.focused() || this.dismissed() || this.advancedOpen()) return null;
    if (this.context()?.blocked) return 'blocked';
    const ctx = this.live();
    if (ctx) return ctx.kind;
    if (!this.text().trim()) return this.saved().length || this.recent().length ? 'home' : null;
    if (this.queryMatches().length) return 'queries';
    return this.textCapsules().length ? 'capsules' : null;
  });

  constructor() {
    // Saved searches feed the suggestions; the bell shows whether the applied search already alerts.
    this.queries.ensureLoaded();

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

    this.labelQuery$
      .pipe(
        debounceTime(200),
        distinctUntilChanged(),
        switchMap((q) => this.labels.search(q)),
      )
      .subscribe((list) => {
        this.labelResults.set(list.slice(0, 8));
        this.active.set(0);
      });

    effect(() => {
      const ctx = this.live();
      const q = ctx?.query.replace(/_/g, ' ') ?? '';
      if (ctx?.kind === 'user' || ctx?.field?.values === 'users') this.userQuery$.next(q);
      if (ctx?.field?.values === 'labels') this.labelQuery$.next(q);
    });
  }

  /**
   * `typed`: a character was typed at the caret, so an operator word or sigil it makes becomes one right away.
   * `ours`: the box made this edit itself (it is already what it should be, so it isn't guarded).
   */
  onInput(typed = false, ours = false) {
    const el = this.input().nativeElement;
    // Editing part of a capsule removes all of it; typing inside one is ignored.
    const guarded = ours ? { text: el.value } : guardEdit(this.text(), el.value, this.snapRanges());
    if (guarded.caret !== undefined) this.setValue(guarded.text, guarded.caret);
    const cleaned = cleanMarks(el.value, el.selectionStart ?? el.value.length);
    if (cleaned) this.setValue(cleaned.text, cleaned.caret);
    const marked = typed && el.selectionStart === el.selectionEnd ? markTyped(el.value, el.selectionStart ?? el.value.length) : null;
    if (marked) this.setValue(marked.text, marked.caret);
    this.text.set(el.value);
    this.textInput.emit(el.value);
    this.dismissed.set(false);
    this.active.set(0);
    this.queryActive.set(-1);
    this.syncCaret();
  }

  /** Caret moves (clicks, arrows) change which shortcut word we're in; the mirror follows the input's scroll. */
  syncCaret() {
    const el = this.input().nativeElement;
    const a0 = el.selectionStart ?? el.value.length;
    const b0 = el.selectionEnd ?? a0;
    const [a, b] = snapSelection(this.snapRanges(), a0, b0, this.prevCaret);
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

  /**
   * Backspace right after an operator word or sigil takes its mark off (it stays as plain text). Capsules are one unit:
   * Backspace / Delete at their edge removes all of it, a letter typed against one gets a space.
   */
  private editKey(e: KeyboardEvent): boolean {
    const el = this.input().nativeElement;
    const caret = el.selectionStart ?? 0;
    if (caret !== el.selectionEnd || e.ctrlKey || e.metaKey || e.altKey) return false;
    const text = el.value;
    const typed = e.key.length === 1 && e.key !== ' ';
    const edit =
      e.key === 'Backspace'
        ? (unmarkBefore(text, caret) ?? deleteCapsule(text, caret, e.key, this.ranges()))
        : e.key === 'Delete'
          ? deleteCapsule(text, caret, e.key, this.ranges())
          : typed
            ? typeBesideCapsule(text, caret, e.key, this.ranges())
            : null;
    if (!edit) return false;
    e.preventDefault();
    this.setValue(edit.text, edit.caret);
    this.onInput(typed, true);
    return true;
  }

  onKey(e: KeyboardEvent) {
    if (this.editKey(e)) return;
    const list = this.suggestions();
    const open = !!this.live();
    if (e.key === 'Escape') {
      if (this.popup()) this.dismissed.set(true);
      else this.input().nativeElement.blur();
    } else if (open && list.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      this.active.update((i) => (i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length);
    } else if (open && list.length && (e.key === 'Enter' || e.key === 'Tab')) {
      e.preventDefault();
      this.pick(list[Math.min(this.active(), list.length - 1)]);
    } else if (this.popup() === 'queries' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      // Saved searches matching the typed text: ↓ / ↑ walk them (and back to the text itself).
      e.preventDefault();
      const n = this.queryMatches().length;
      this.queryActive.update((i) => (e.key === 'ArrowDown' ? (i + 1 >= n ? -1 : i + 1) : i <= -1 ? n - 1 : i - 1));
    } else if (e.key === 'Enter' && this.popup() === 'queries' && this.queryActive() >= 0) {
      e.preventDefault();
      this.runSaved(this.queryMatches()[this.queryActive()]);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.submit();
    }
  }

  pickCapsule(capsule: ICapsule) {
    this.pick({ kind: 'capsule', capsule });
  }

  pick(s: Suggestion) {
    const ctx = this.live();
    if (!ctx) return;
    if (s.kind === 'saved') return this.runSaved(s.saved);
    // A picked value replaces what was typed, `_` for its spaces (a space ends the field).
    const seg = ctx.kind === 'value' ? ctx.segment! : undefined;
    const value = (v: string) => v.trim().replace(/\s+/g, '_');
    const token =
      s.kind === 'user'
        ? ctx.kind === 'value'
          ? value(s.user.fullName)
          : `${MARK}@${s.user.username}`
        : s.kind === 'type'
          ? value(s.type.displayName)
          : s.kind === 'color'
            ? value(s.name)
            : s.kind === 'label'
              ? value(s.label)
              : s.kind === 'field'
                ? `${MARK}:${s.field.name}:`
                : s.kind === 'capsule'
                  ? capsuleSearchToken(s.capsule)
                  : '';
    // A picked field goes straight on to its value.
    const next = replaceShortcut(this.text(), seg ? { ...ctx, ...seg } : ctx, token, s.kind !== 'field');
    const el = this.input().nativeElement;
    el.value = next.text;
    el.focus();
    el.setSelectionRange(next.caret, next.caret);
    this.onInput(false, true);
  }

  /** A picked $saved search replaces the whole search with it (its own sort, if it has one). */
  runSaved(saved: IQuery) {
    this.apply(saved.search, saved.search.sort);
    this.input().nativeElement.blur();
  }

  submit() {
    this.eggs.onSearch(this.text());
    this.capsules.ensure({ names: capsuleNames(this.text()) });
    this.apply({ ...this.search(), text: this.text().trim() || undefined });
    this.input().nativeElement.blur();
  }

  /** A saved search loaded into the advanced panel to build on: its filters are what the panel counts and runs with. */
  readonly advancedBase = signal<ISummarySearch | null>(null);

  toggleAdvanced(open = !this.advancedOpen()) {
    this.advancedOpen.set(open);
    this.advancedBase.set(null);
  }

  /** The panel loaded a saved search: its text comes into the box, its other filters replace the applied ones. */
  loadIntoAdvanced(q: IQuery) {
    const { sort: _, ...rest } = stripPaging(q.search);
    this.advancedBase.set(rest);
    this.text.set(q.search.text ?? '');
    this.textInput.emit(this.text());
  }

  runAdvanced(query: IQueryGroup | undefined) {
    const base = this.advancedBase() ?? this.search();
    this.toggleAdvanced(false);
    this.apply({ ...base, text: this.text().trim() || undefined, query });
  }

  apply(s: ISummarySearch, sort = this.search().sort) {
    this.history.add(s);
    this.searchChange.emit({ ...s, sort });
  }

  clear() {
    this.text.set('');
    this.searchChange.emit({ sort: this.search().sort });
  }

  /** The applied search's alert: on its saved query, if it is saved and alerts. */
  readonly alert = computed(() => this.savedMatch()?.alert ?? null);
  /** A search that selects something can become an alert. */
  readonly canAlert = computed(() => Object.keys(alertSearch(this.search())).length > 0);
  readonly alertBusy = signal(false);

  /**
   * Bell: get notified about summaries published (or edited) later that this search finds — or stop. An alert lives on
   * a query, so alerting on a search that isn't saved yet saves it too (named after it).
   */
  toggleAlert() {
    if (this.alertBusy()) return;
    const saved = this.savedMatch();
    this.alertBusy.set(true);
    const done = () => this.alertBusy.set(false);
    const req = saved?.alert
      ? this.queries.removeAlert(saved._id)
      : saved
        ? this.queries.setAlert(saved._id, { isActive: true })
        : this.queries.create(describeSearch(this.search()).slice(0, 120), this.search().query ? 'advanced' : 'simple', this.search(), { isActive: true });
    const text = saved?.alert ? 'ההתראה על החיפוש בוטלה' : saved ? 'תתקבל התראה על תמציות חדשות שמתאימות לחיפוש' : 'החיפוש נשמר, ותתקבל התראה על תמציות חדשות שמתאימות לו';
    req.subscribe({ next: () => this.message.success(text), complete: done, error: done });
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

  /** The save popover starts from the saved name, or a description of the search to edit. */
  onSavePopover(open: boolean) {
    this.saveOpen.set(open);
    if (open) this.saveName.set(this.savedMatch()?.name ?? describeSearch(this.search()));
  }

  /** Saves the applied search under the typed name (renames it when already saved). */
  saveSearch() {
    const name = this.saveName().trim();
    if (this.saveBusy() || !name) return;
    const existing = this.savedMatch();
    const req = existing ? this.queries.update(existing._id, { name }) : this.queries.create(name, this.search().query ? 'advanced' : 'simple', this.search());
    this.saveBusy.set(true);
    const done = () => this.saveBusy.set(false);
    req.subscribe({
      next: () => {
        this.saveOpen.set(false);
        this.message.success(existing ? 'שם החיפוש עודכן' : 'החיפוש נשמר — אפשר למצוא אותו גם בעמוד הפרופיל');
      },
      complete: done,
      error: done,
    });
  }

  unsaveCurrent() {
    const existing = this.savedMatch();
    if (!existing) return;
    this.saveOpen.set(false);
    this.queries.remove(existing._id).subscribe(() => this.message.success(existing.alert ? 'החיפוש הוסר מהשמורים, וגם ההתראה עליו' : 'החיפוש הוסר מהשמורים'));
  }

  unsave(s: IQuery, event: Event) {
    // Let the refreshed query list drive removal instead of nz-tag removing its own DOM.
    event.preventDefault();
    event.stopPropagation();
    this.queries.remove(s._id).subscribe();
  }

  readonly describe = describeSearch;
  readonly kindLabel = QUERY_KIND_LABEL;

  /** "/" anywhere focuses the search input. */
  onGlobalKey(e: KeyboardEvent) {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, [contenteditable="true"], .ql-editor')) return;
    e.preventDefault();
    this.input().nativeElement.focus();
  }
}
