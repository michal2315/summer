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
import { CapsuleChipComponent } from '../../../shared/components/capsules/capsule-chip/capsule-chip.component';
import { CapsuleSuggestComponent } from '../../../shared/components/capsules/capsule-suggest/capsule-suggest.component';
import { ICapsule, IContentType, IQueryGroup, ISavedSearch, ISummarySearch, UserRef } from '../../../shared/models';
import { CapsuleService, capsuleSuggestions } from '../../../shared/services/capsule.service';
import { ContentTypeService } from '../../../shared/services/content-type.service';
import { SearchHistoryService, stripPaging } from '../../../shared/services/search-history.service';
import { capsuleSearchToken, treeCapsuleIds } from '../../../shared/utils/capsules';
import {
  COLOR_NAMES,
  END,
  MARK,
  SEARCH_FIELDS,
  SearchField,
  capsuleRanges,
  cleanMarks,
  deleteCapsule,
  fieldTokenAt,
  guardEdit,
  markHeads,
  operatorWordAt,
  parseQuery,
  querySegments,
  replaceShortcut,
  shortcutAt,
  snapSelection,
  typeBesideCapsule,
} from '../../../shared/utils/search-syntax';
import { LabelService } from '../../../shared/services/label.service';
import { EasterEggsService } from '../../../shared/easter-eggs/easter-eggs.service';
import { AltKeyDirective } from '../../../shared/keyboard/alt-key.directive';
import { AdvancedSearchComponent } from '../advanced-search/advanced-search.component';
import { countConditions } from '../advanced-search/query-tree';
import { NotificationsSettingsService } from '../../notifications/notification-rules';
import { SAVED_SEARCH_KIND_LABEL, activeFilterCount, alertSearch, describeSearch, savedSearchName, searchToParams } from '../search-query';

const sameSearch = (a: ISummarySearch, b: ISummarySearch) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
const normalize = (s: ISummarySearch) =>
  Object.fromEntries(
    Object.entries(stripPaging(s))
      .filter(([k, v]) => k !== 'sort' && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length))
      .sort(([a], [b]) => a.localeCompare(b)),
  );

const M = MARK;
const E = END;

/** Cheat-sheet in the popover over the "/" key. */
const SHORTCUTS: { example: string; hint: string }[] = [
  { example: `גרף ${M}וגם עץ`, hint: 'שתי המילים (וגם / and, ואז ←)' },
  { example: `גרף ${M}או עץ`, hint: 'אחת מהמילים (או / or, ואז ←)' },
  { example: `גרף ${M}לא מכוון`, hint: 'בלי המילה (לא / ולא / בלי / not, ואז ←)' },
  { example: 'מבוא', hint: 'כל מקום שהמילה מופיעה בו, גם כחלק ממילה' },
  { example: '"מבוא"', hint: 'התאמה מדויקת: מילה או ביטוי שלמים' },
  { example: `${M}@משתמש`, hint: 'תמציות של משתמש (@ ואז ←)' },
  { example: `${M}:כותרת:מבוא לביולוגיה${E}`, hint: 'חיפוש בשדה (: ואז ←; הערך יכול לכלול רווחים, ← לסיום)' },
  { example: `${M}:סוג:שיעור${E}`, hint: 'גם כותב, תווית, צבע, תוכן, הערות, תגובות' },
  { example: `${M}#כמוסה`, hint: 'כמוסה: קבוצת מילים שמורה (# ואז ←)' },
  { example: `${M}#שם_עם_רווחים`, hint: '_ במקום רווח בשמות כמוסות' },
  { example: `${M}$חיפוש_שמור`, hint: 'הרצת חיפוש שמור ($ ואז ←, ובחירה מהרשימה)' },
  { example: '←', hint: 'בלי ← המילים והסימנים נחפשים כטקסט רגיל' },
  { example: '/', hint: 'מעבר לתיבת החיפוש מכל מקום' },
  { example: '↑ ↓ Enter', hint: 'בחירה מההצעות (גם Tab או ←)' },
  { example: 'Esc', hint: 'סגירת ההצעות' },
];

type Suggestion =
  | { kind: 'user'; user: UserRef }
  | { kind: 'type'; type: IContentType }
  | { kind: 'capsule'; capsule: ICapsule }
  | { kind: 'field'; field: SearchField }
  | { kind: 'color'; name: string; hex: string }
  | { kind: 'label'; label: string }
  | { kind: 'saved'; saved: ISavedSearch };

/** What ← turns the word at the caret into, for the hint under the box. */
const OPERATOR_HINTS: Record<'and' | 'or' | 'not', string> = {
  and: 'שתי המילים',
  or: 'אחת מהמילים',
  not: 'בלי המילה שאחריו',
};
const SIGIL_HINTS: Record<'user' | 'field' | 'value' | 'capsule' | 'saved', string> = {
  user: 'חיפוש לפי משתמש',
  field: 'חיפוש בשדה',
  value: 'חיפוש בשדה',
  capsule: 'כמוסה',
  saved: 'חיפוש שמור',
};

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
    AdvancedSearchComponent, AltKeyDirective, CapsuleChipComponent, CapsuleSuggestComponent, NotificationBellComponent],
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
  private readonly labels = inject(LabelService);
  private readonly alerts = inject(NotificationsSettingsService);
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
  /** Known capsules and marked operators in the box: they behave as one unit for the caret, Backspace and Delete. */
  private readonly ranges = computed(() => capsuleRanges(this.text(), this.isCapsule));
  /** Plus the invisible mark before each @ / : / #, which the caret skips. */
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
  /** What ← would do here, shown as a hint: mark an operator word, or the @ / : / # being typed. */
  readonly arrowHint = computed(() => {
    const ctx = this.context();
    if (ctx && !ctx.marked) return SIGIL_HINTS[ctx.kind];
    if (ctx) return null;
    const op = operatorWordAt(this.text(), this.caret());
    return op ? `"${op.word}" כאופרטור: ${OPERATOR_HINTS[op.op]}` : null;
  });
  readonly saved = computed(() => this.users.user()?.pinnedSearches ?? []);
  readonly recent = computed(() => this.history.recent().slice(0, 5));
  readonly filterCount = computed(() => activeFilterCount(this.search()));
  /** The saved search the applied search matches, if any. */
  readonly savedMatch = computed(() => this.saved().find((p) => sameSearch(p.search, this.search())));
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
        .filter((saved) => !q || savedSearchName(saved).toLowerCase().includes(q))
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

  /** What the popup under the box shows, if anything ('hint': what ← does; 'capsules': the capsules in the text, to look inside). */
  readonly popup = computed<'hint' | 'user' | 'field' | 'value' | 'capsule' | 'saved' | 'capsules' | 'home' | null>(() => {
    if (!this.focused() || this.dismissed() || this.advancedOpen()) return null;
    const ctx = this.live();
    if (ctx) return ctx.kind;
    if (this.arrowHint()) return 'hint';
    if (!this.text().trim()) return this.saved().length || this.recent().length ? 'home' : null;
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

  onInput() {
    const el = this.input().nativeElement;
    // Editing part of a capsule removes all of it; typing inside one is ignored.
    const guarded = guardEdit(this.text(), el.value, this.snapRanges());
    if (guarded.caret !== undefined) this.setValue(guarded.text, guarded.caret);
    const cleaned = cleanMarks(el.value, el.selectionStart ?? el.value.length);
    if (cleaned) this.setValue(cleaned.text, cleaned.caret);
    this.text.set(el.value);
    this.textInput.emit(el.value);
    this.dismissed.set(false);
    this.active.set(0);
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

  /** Capsules are one unit: Backspace / Delete at their edge removes all of it, a letter typed against one gets a space. */
  private capsuleKey(e: KeyboardEvent): boolean {
    const el = this.input().nativeElement;
    const caret = el.selectionStart ?? 0;
    if (caret !== el.selectionEnd || e.ctrlKey || e.metaKey || e.altKey) return false;
    const field = e.key === 'Backspace' ? this.closedFieldBefore(el.value, caret) : undefined;
    const edit = field
      ? this.backspaceField(el.value, field)
      : e.key === 'Backspace' || e.key === 'Delete'
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

  /** The closed :field:value token that ends right at the caret. */
  private closedFieldBefore(text: string, caret: number) {
    const t = caret > 0 && text[caret - 1] === END ? fieldTokenAt(text, caret - 1) : undefined;
    return t?.closed && t.end === caret ? t : undefined;
  }

  /** Deletes the value's last character (keeping the token closed); an emptied value takes the whole token with it. */
  private backspaceField(text: string, t: { start: number; end: number }) {
    const value = /^\u2063:[^:]*:([\s\S]*)\u2064$/.exec(text.slice(t.start, t.end));
    if (!value || value[1].length <= 1) return { text: text.slice(0, t.start) + text.slice(t.end), caret: t.start };
    return { text: text.slice(0, t.end - 2) + text.slice(t.end - 1), caret: t.end - 1 };
  }

  /**
   * ← at the end of a word: marks an operator word or the @ / : / # being typed (until then they are plain text), or
   * picks the highlighted suggestion. Elsewhere it moves the caret as usual.
   */
  private arrowKey(e: KeyboardEvent): boolean {
    const el = this.input().nativeElement;
    const caret = el.selectionStart ?? 0;
    if (e.key !== 'ArrowLeft' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || caret !== el.selectionEnd || this.dismissed()) return false;
    const text = el.value;
    const ctx = this.context();
    // Inside a :field:value, ← leaves it: picks the highlighted value, or closes what was typed.
    if (ctx?.marked && (ctx.kind === 'field' || ctx.kind === 'value')) {
      e.preventDefault();
      const list = this.suggestions();
      if (list.length && ctx.query.trim()) this.pick(list[Math.min(this.active(), list.length - 1)]);
      else if (ctx.kind === 'value' && ctx.query.trim()) this.closeField(text, ctx);
      return true;
    }
    if (caret < text.length && !/\s/.test(text[caret])) return false;
    const mark = (at: number) => {
      e.preventDefault();
      this.setValue(text.slice(0, at) + MARK + text.slice(at), caret + 1);
      this.onInput();
      return true;
    };
    if (ctx && !ctx.marked) return mark(ctx.start);
    if (ctx) {
      // Marked already: ← picks what's highlighted once something is typed (an empty value just opens its list).
      e.preventDefault();
      const list = this.suggestions();
      if (list.length && ctx.query) this.pick(list[Math.min(this.active(), list.length - 1)]);
      return true;
    }
    const op = operatorWordAt(text, caret);
    return op ? mark(op.start) : false;
  }

  /** Ends the :field:value at the caret (or after its END when already closed) and moves on past a space. */
  private closeField(text: string, ctx: { end: number; closed?: boolean }) {
    const at = ctx.end;
    const head = text.slice(0, at) + (ctx.closed ? '' : END);
    const rest = text.slice(at);
    const next = head + ' ' + rest.replace(/^ /, '');
    this.setValue(next, head.length + 1);
    this.onInput();
  }

  onKey(e: KeyboardEvent) {
    if (this.capsuleKey(e) || this.arrowKey(e)) return;
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
    const value = (v: string) => `${MARK}:${ctx.fieldName}:${v.trim()}${END}`;
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
    const next = replaceShortcut(this.text(), ctx, token, s.kind !== 'field');
    const el = this.input().nativeElement;
    el.value = next.text;
    el.focus();
    el.setSelectionRange(next.caret, next.caret);
    this.onInput();
  }

  /** A picked $saved search replaces the whole search with it (its own sort, if it has one). */
  runSaved(saved: ISavedSearch) {
    this.apply(saved.search, saved.search.sort);
    this.input().nativeElement.blur();
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

  apply(s: ISummarySearch, sort = this.search().sort) {
    this.history.add(s);
    this.searchChange.emit({ ...s, sort });
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
        .addAlert(this.search(), this.savedMatch()?.name)
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
    const req = existing ? this.users.updateSearch(existing._id, { name }) : this.users.pinSearch(stripPaging(this.search()), true, name, 'simple');
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
    this.users.pinSearch(existing.search, false).subscribe();
  }

  unsave(s: ISavedSearch, event: Event) {
    // Let the refreshed user.pinnedSearches drive removal instead of nz-tag removing its own DOM.
    event.preventDefault();
    event.stopPropagation();
    this.users.pinSearch(s.search, false).subscribe();
  }

  readonly describe = describeSearch;
  readonly savedName = savedSearchName;
  readonly kindLabel = SAVED_SEARCH_KIND_LABEL;

  /** "/" anywhere focuses the search input. */
  onGlobalKey(e: KeyboardEvent) {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, [contenteditable="true"], .ql-editor')) return;
    e.preventDefault();
    this.input().nativeElement.focus();
  }
}
