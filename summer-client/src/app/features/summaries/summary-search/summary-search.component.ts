import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { NzBadgeModule } from 'ng-zorro-antd/badge';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCheckboxModule, NzCheckboxOption } from 'ng-zorro-antd/checkbox';
import { NzDatePickerModule } from 'ng-zorro-antd/date-picker';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzSwitchModule } from 'ng-zorro-antd/switch';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { Subject, debounceTime, distinctUntilChanged, filter, map, switchMap } from 'rxjs';
import { UserService } from '../../../core/auth/user.service';
import { NotificationBellComponent } from '../../../shared/components/notification-bell.component';
import { ICollectionRef, ISummarySearch, SearchType, UserRef } from '../../../shared/models';
import { SUMMARY_COLORS } from '../../../shared/models/colors';
import { CatalogService } from '../../../shared/services/catalog.service';
import { SearchHistoryService, stripPaging } from '../../../shared/services/search-history.service';
import { activeFilterCount } from '../search-query';

const SEARCH_TYPE_OPTIONS: NzCheckboxOption[] = [
  { label: 'כותרת', value: SearchType.Title },
  { label: 'תוכן הסיכום', value: SearchType.Content },
  { label: 'תגיות', value: SearchType.Label },
  { label: 'הערות', value: SearchType.Notes },
  { label: 'תגובות', value: SearchType.Comments },
];

const sameSearch = (a: ISummarySearch, b: ISummarySearch) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
const normalize = (s: ISummarySearch) =>
  Object.fromEntries(
    Object.entries(stripPaging(s))
      .filter(([k, v]) => k !== 'sort' && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length))
      .sort(([a], [b]) => a.localeCompare(b)),
  );

@Component({
  selector: 'app-summary-search',
  imports: [
    ReactiveFormsModule,
    NzBadgeModule,
    NzButtonModule,
    NzCheckboxModule,
    NzDatePickerModule,
    NzIconModule,
    NzInputModule,
    NzSelectModule,
    NzSwitchModule,
    NzTagModule,
    NzToolTipModule,
    NotificationBellComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './summary-search.component.html',
  styleUrl: './summary-search.component.scss',
  host: {
    '(document:keydown)': 'onGlobalKey($event)',
    '(keydown.escape)': 'close()',
  },
})
export class SummarySearchComponent {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly users = inject(UserService);
  private readonly catalog = inject(CatalogService);
  private readonly history = inject(SearchHistoryService);

  /** Currently applied search (from the URL). */
  readonly search = input<ISummarySearch>({});
  readonly showBell = input(true);
  readonly placeholder = input('חיפוש סיכומים');
  readonly searchChange = output<ISummarySearch>();

  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('searchInput');

  readonly open = signal(false);
  readonly searchTypeOptions = SEARCH_TYPE_OPTIONS;
  readonly colors = SUMMARY_COLORS;
  readonly contentTypeOptions = computed<NzCheckboxOption[]>(() =>
    this.catalog.contentTypes().map((t) => ({ label: t.displayName, value: t.name })),
  );
  readonly pinned = computed(() => this.users.user()?.pinnedSearches ?? []);
  readonly recent = computed(() => this.history.recent().slice(0, 5));
  readonly filterCount = computed(() => activeFilterCount(this.search()));
  readonly isPinned = computed(() => this.pinned().some((p) => sameSearch(p, this.search())));

  readonly form = this.fb.group({
    text: '',
    searchTypes: [[] as string[]],
    colors: [[] as string[]],
    contentTypes: [[] as string[]],
    allUsers: true,
    users: [[] as string[]],
    allCollections: true,
    collections: [[] as string[]],
    dates: this.fb.control<Date[] | null>(null),
    createdDates: this.fb.control<Date[] | null>(null),
  });

  // Server-driven option lists (debounced search), seeded with names for ids already in the URL.
  readonly userOptions = signal<UserRef[]>([]);
  readonly collectionOptions = signal<ICollectionRef[]>([]);
  private readonly userQuery$ = new Subject<string>();
  private readonly collectionQuery$ = new Subject<string>();

  readonly allUsers = toSignal(this.form.controls.allUsers.valueChanges, { initialValue: true });
  readonly allCollections = toSignal(this.form.controls.allCollections.valueChanges, { initialValue: true });

  constructor() {
    effect(() => {
      const s = this.search();
      untracked(() => this.reset(s));
    });

    this.userQuery$
      .pipe(
        map((t) => t.trim()),
        filter((t) => t.length > 1),
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((t) => this.users.byName(t)),
      )
      .subscribe((list) => this.userOptions.set(this.mergeById(this.selectedUsers(), list)));

    this.collectionQuery$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((t) => this.catalog.collectionsByName(t)),
      )
      .subscribe((list) => this.collectionOptions.set(this.mergeById(this.selectedCollections(), list)));
  }

  /** Load form from the applied search. */
  private reset(s: ISummarySearch) {
    this.form.reset({
      text: s.text ?? '',
      searchTypes: s.searchTypes ?? [],
      colors: s.colors ?? [],
      contentTypes: s.contentTypes ?? [],
      allUsers: !s.users?.length,
      users: s.users ?? [],
      allCollections: !s.collections?.length,
      collections: s.collections ?? [],
      dates: s.dates?.length === 2 ? s.dates.map((d) => new Date(d)) : null,
      createdDates: s.createdDates?.length === 2 ? s.createdDates.map((d) => new Date(d)) : null,
    });
    if (s.users?.length && !s.users.every((id) => this.userOptions().some((u) => u._id === id))) {
      this.users.byIds(s.users).subscribe((list) => this.userOptions.set(this.mergeById(list, this.userOptions())));
    }
    if (s.collections?.length) {
      this.catalog.collectionsByIds(s.collections).subscribe((list) => this.collectionOptions.set(this.mergeById(list, this.collectionOptions())));
    }
  }

  private fromForm(): ISummarySearch {
    const v = this.form.getRawValue();
    const range = (r: Date[] | null) => (r?.length === 2 ? r.map((d) => d.toISOString()) : undefined);
    return {
      text: v.text.trim() || undefined,
      searchTypes: v.searchTypes.length ? (v.searchTypes as SearchType[]) : undefined,
      colors: v.colors.length ? v.colors : undefined,
      contentTypes: v.contentTypes.length ? v.contentTypes : undefined,
      users: !v.allUsers && v.users.length ? v.users : undefined,
      collections: !v.allCollections && v.collections.length ? v.collections : undefined,
      dates: range(v.dates),
      createdDates: range(v.createdDates),
      sort: this.search().sort,
    };
  }

  submit() {
    this.apply(this.fromForm());
  }

  apply(s: ISummarySearch) {
    this.history.add(s);
    this.searchChange.emit({ ...s, sort: this.search().sort });
    this.close();
  }

  clear() {
    this.searchChange.emit({ sort: this.search().sort });
    this.close();
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

  toggleColor(c: string) {
    const cur = this.form.controls.colors.value;
    this.form.controls.colors.setValue(cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]);
  }

  setAll(control: 'searchTypes' | 'contentTypes', options: NzCheckboxOption[], checked: boolean) {
    this.form.controls[control].setValue(checked ? options.map((o) => String(o.value)) : []);
  }

  allState(values: string[], options: NzCheckboxOption[]): 'all' | 'some' | 'none' {
    if (!values.length) return 'none';
    return values.length >= options.length ? 'all' : 'some';
  }

  describe(s: ISummarySearch): string {
    const parts = [s.text, s.contentTypes?.length ? `${s.contentTypes.length} סוגי תוכן` : '', s.colors?.length ? 'צבעים' : ''].filter(Boolean);
    return parts.join(' · ') || 'חיפוש ללא טקסט';
  }

  searchUsers(text: string) {
    this.userQuery$.next(text);
  }

  searchCollections(text: string) {
    this.collectionQuery$.next(text);
  }

  openPanel() {
    this.open.set(true);
    if (!this.collectionOptions().length) this.collectionQuery$.next('');
  }

  close() {
    this.open.set(false);
  }

  /** "/" anywhere focuses the search input. */
  onGlobalKey(e: KeyboardEvent) {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, [contenteditable="true"], .ql-editor')) return;
    e.preventDefault();
    this.input().nativeElement.focus();
  }

  private selectedUsers() {
    const ids = this.form.controls.users.value;
    return this.userOptions().filter((u) => ids.includes(u._id));
  }

  private selectedCollections() {
    const ids = this.form.controls.collections.value;
    return this.collectionOptions().filter((c) => ids.includes(c._id));
  }

  private mergeById<T extends { _id: string }>(a: T[], b: T[]): T[] {
    const seen = new Set<string>();
    return [...a, ...b].filter((x) => !seen.has(x._id) && seen.add(x._id));
  }
}
