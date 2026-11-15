import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { Observable, catchError, concat, debounceTime, of, switchMap } from 'rxjs';
import { HasPendingChanges } from '../../../core/auth/guards';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { IQuery, IQueryGroup, ISummarySearch, QueryKind, SearchType } from '../../../shared/models';
import { ContentTypeService } from '../../../shared/services/content-type.service';
import { QueryService } from '../../../shared/services/query.service';
import { SummaryService } from '../../../shared/services/summary.service';
import { AdvancedSearchComponent } from '../../summaries/advanced-search/advanced-search.component';
import { countConditions } from '../../summaries/advanced-search/query-tree';
import { alertSearch, describeSearch, sameAlertSearch, searchToParams } from '../../summaries/search-query';
import { SummarySearchComponent } from '../../summaries/summary-search/summary-search.component';
import { NotificationsSettingsService } from '../notification-rules';

/** Search filters shown as chips (the text and the advanced search have their own editors). */
type FilterKey = 'searchTypes' | 'contentTypes' | 'labels' | 'colors' | 'users' | 'folders' | 'dates' | 'createdDates';
const SEARCH_IN: Partial<Record<SearchType, string>> = {
  [SearchType.Title]: 'כותרת',
  [SearchType.Content]: 'תוכן',
  [SearchType.Label]: 'תגיות',
  [SearchType.Notes]: 'הערות',
  [SearchType.Comments]: 'תגובות',
  [SearchType.Color]: 'צבע',
};

/**
 * /notifications/create and /notifications/:id/edit (a query's id) — a saved search with its alert: the name, simple
 * (search box text) or advanced (with the condition builder, including content-type fields), and how it notifies.
 * Every alert is a query, so what is made here is also one of the user's saved searches.
 */
@Component({
  selector: 'app-create-notification',
  imports: [FormsModule, RouterLink, NzButtonModule, NzCheckboxModule, NzIconModule, NzInputModule, NzRadioModule, AdvancedSearchComponent, SkeletonComponent, SummarySearchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './create-notification.component.html',
  styleUrl: './create-notification.component.scss',
})
export class CreateNotificationComponent implements HasPendingChanges {
  private readonly queries = inject(QueryService);
  private readonly settings = inject(NotificationsSettingsService);
  private readonly router = inject(Router);
  private readonly message = inject(NzMessageService);
  private readonly contentTypes = inject(ContentTypeService);
  private readonly summaries = inject(SummaryService);

  /** Route param on the edit route: the query's id. */
  readonly id = input<string | undefined>(undefined);

  readonly name = signal('');
  readonly kind = signal<QueryKind>('advanced');
  /** The search's filters other than its text and tree (from a query being edited); removable as chips. */
  readonly base = signal<ISummarySearch>({});
  readonly text = signal('');
  readonly query = signal<IQueryGroup | undefined>(undefined);
  /** What seeds the search box and the builder (they report their changes back; reseeded only on load). */
  readonly seed = signal<ISummarySearch>({});

  readonly alertOn = signal(true);
  readonly isActive = signal(true);
  readonly isMail = signal(false);
  readonly isDigest = signal(false);

  readonly submitted = signal(false);
  readonly saving = signal(false);
  /** Editing: the query is on its way. */
  readonly loading = signal(false);
  private editing: IQuery | null = null;
  private dirty = false;
  private saved = false;

  /** The search as it would be saved (a simple query has no tree). */
  readonly draft = computed<ISummarySearch>(() => ({
    ...this.base(),
    text: this.text().trim() || undefined,
    query: this.kind() === 'advanced' ? this.query() : undefined,
  }));
  readonly empty = computed(() => !Object.keys(alertSearch(this.draft())).length);
  /** Another saved search that already finds the same summaries (the server refuses a duplicate). */
  readonly clash = computed(() => this.queries.queries().find((q) => q._id !== this.id() && sameAlertSearch(q.search, this.draft())));
  /** Switching an advanced query with conditions to simple drops them. */
  readonly dropsTree = computed(() => this.kind() === 'simple' && !!this.query() && countConditions(this.query()!) > 0);

  /** Why this alert's e-mails wouldn't go out, if they wouldn't. */
  readonly mailBlocked = computed(() => {
    const p = this.settings.preferences();
    if (!p) return '';
    if (!p.email) return 'אין כתובת מייל בחשבון שלך, ולכן לא יישלחו מיילים.';
    return p.mailAlerts ? '' : 'מיילים על התראות כבויים בניהול ההתראות, ולכן לא יישלחו מיילים על ההתראה הזו.';
  });

  /** How many summaries the search finds right now (null while counting). */
  readonly matchCount = toSignal(
    toObservable(this.draft).pipe(
      debounceTime(350),
      switchMap((s) => (Object.keys(alertSearch(s)).length ? concat(of(null), this.summaries.count(s).pipe(catchError(() => of(null)))) : of(null))),
    ),
    { initialValue: null },
  );

  /** The search's filters the editors don't show, one removable chip each. */
  readonly searchFilters = computed(() => {
    const s = this.base();
    const typeNames = new Map(this.contentTypes.list().map((t) => [t.name, t.displayName]));
    const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('he-IL') : '…');
    const range = (r?: string[]) => `${day(r?.[0])} – ${day(r?.[1])}`;
    const chips: { key: FilterKey; label: string }[] = [];
    if (s.searchTypes?.length) chips.push({ key: 'searchTypes', label: `הטקסט רק ב: ${s.searchTypes.map((t) => SEARCH_IN[t] ?? t).join(', ')}` });
    if (s.contentTypes?.length) chips.push({ key: 'contentTypes', label: `סוג תוכן: ${s.contentTypes.map((n) => typeNames.get(n) ?? n).join(', ')}` });
    if (s.labels?.length) chips.push({ key: 'labels', label: `תגיות: ${s.labels.join(', ')}` });
    if (s.colors?.length) chips.push({ key: 'colors', label: `${s.colors.length} צבעים` });
    if (s.users?.length) chips.push({ key: 'users', label: `${s.users.length} כותבים` });
    if (s.folders?.length) chips.push({ key: 'folders', label: `${s.folders.length} תיקיות` });
    if (s.dates?.length) chips.push({ key: 'dates', label: `תאריך האירוע: ${range(s.dates)}` });
    if (s.createdDates?.length) chips.push({ key: 'createdDates', label: `נכתבה: ${range(s.createdDates)}` });
    return chips;
  });

  constructor() {
    this.queries.ensureLoaded();
    this.settings.loadPreferences();
    // Editing: fill the form once the query list is in.
    effect(() => {
      const id = this.id();
      const list = this.queries.list();
      if (!id) return;
      if (list === null) {
        untracked(() => this.loading.set(true));
        return;
      }
      untracked(() => this.fill(id));
    });
  }

  private fill(id: string) {
    if (this.editing?._id === id) return;
    this.loading.set(false);
    const q = this.queries.byId(id);
    if (!q) {
      this.router.navigate(['/notifications']);
      return;
    }
    this.editing = q;
    const { text, query, sort: _sort, ...rest } = alertSearch(q.search);
    this.name.set(q.name);
    this.kind.set(q.kind);
    this.base.set(rest);
    this.text.set(text ?? '');
    this.query.set(query);
    this.seed.set({ text, query });
    this.alertOn.set(!!q.alert);
    this.isActive.set(q.alert?.isActive ?? true);
    this.isMail.set(q.alert?.isMail ?? false);
    this.isDigest.set(q.alert?.isDigest ?? false);
    this.dirty = false;
  }

  /** Any edit marks the form dirty (leaving asks first). */
  touch() {
    this.dirty = true;
  }

  setKind(kind: QueryKind) {
    this.kind.set(kind);
    this.touch();
  }

  onText(text: string) {
    this.text.set(text);
    this.touch();
  }

  onQuery(q: IQueryGroup | undefined) {
    // The builder reports its seed right away; that is not an edit.
    if (JSON.stringify(q ?? null) !== JSON.stringify(this.query() ?? null)) this.touch();
    this.query.set(q);
  }

  /** The builder started from a saved search: take its text and filters too. */
  onLoaded(q: IQuery) {
    const { text, query, sort: _sort, ...rest } = alertSearch(q.search);
    this.base.set(rest);
    this.text.set(text ?? '');
    this.query.set(query);
    this.seed.set({ text, query });
    if (!this.name().trim()) this.name.set(q.name);
    this.touch();
  }

  /** Enter in the search box: take its text (the other filters stay). */
  onSearch(s: ISummarySearch) {
    this.onText(s.text ?? '');
  }

  removeFilter(key: FilterKey) {
    const s = { ...this.base() };
    delete s[key];
    this.base.set(s);
    this.touch();
  }

  /** Opens the search in the feed. */
  openSearch() {
    if (!this.empty()) this.router.navigate(['/summaries'], { queryParams: searchToParams(this.draft()) });
  }

  readonly describeSearch = describeSearch;

  canLeave(): boolean {
    return this.saved || !this.dirty;
  }

  save() {
    this.submitted.set(true);
    const name = this.name().trim();
    if (!name || this.empty() || this.clash() || this.saving()) return;
    const alert = { isActive: this.isActive(), isMail: this.isMail(), isDigest: this.isDigest() };
    const search = this.draft();
    let req: Observable<IQuery>;
    if (!this.editing) {
      req = this.queries.create(name, this.kind(), search, this.alertOn() ? alert : undefined);
    } else {
      const id = this.editing._id;
      const hadAlert = !!this.editing.alert;
      req = this.queries.update(id, { name, kind: this.kind(), search }).pipe(
        switchMap((q) => (this.alertOn() ? this.queries.setAlert(id, alert) : hadAlert ? this.queries.removeAlert(id) : of(q))),
      );
    }
    this.saving.set(true);
    req.subscribe({
      next: () => {
        this.saved = true;
        this.message.success(this.editing ? 'החיפוש וההתראה עודכנו' : this.alertOn() ? 'החיפוש נשמר עם התראה' : 'החיפוש נשמר');
        this.router.navigate(['/notifications']);
      },
      error: () => this.saving.set(false),
    });
  }
}
