import { AltKeyDirective } from '../../../shared/keyboard/alt-key.directive';
import { NgTemplateOutlet } from '@angular/common';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzTabsModule } from 'ng-zorro-antd/tabs';
import { FormsModule } from '@angular/forms';
import { ResizablePageComponent } from '../../../shared/components/resizable-page/resizable-page.component';
import { ScrollRailComponent } from '../../../shared/components/scroll-rail/scroll-rail.component';
import { ICollection, ISummary, ISummarySearch, SortKey, SummaryKind, SummarySearch } from '../../../shared/models';
import { DEFAULT_SORT, searchFromParams, searchToParams } from '../search-query';
import { SortRowComponent } from '../sort-row/sort-row.component';
import { SummaryActionsBarComponent } from '../summary-actions-bar/summary-actions-bar.component';
import { SummariesTableComponent } from '../summaries-table/summaries-table.component';
import { SummaryDetailComponent } from '../summary-detail/summary-detail.component';
import { SummaryListStore } from '../summary-list.store';
import { SummaryListComponent } from '../summary-list/summary-list.component';
import { SummarySearchComponent } from '../summary-search/summary-search.component';
import { SumaroonTimelineComponent } from '../../running/sumaroon-timeline/sumaroon-timeline.component';

const TABS: { value: SummarySearch; label: string; key: 'summary' | 'draft' | 'tagged' | 'favorite' }[] = [
  { value: SummarySearch.Summary, label: 'תמציות', key: 'summary' },
  { value: SummarySearch.Draft, label: 'טיוטות', key: 'draft' },
  { value: SummarySearch.Tagged, label: 'תיוגים', key: 'tagged' },
  { value: SummarySearch.Favorite, label: 'מועדפים', key: 'favorite' },
];

type View = 'list' | 'table' | 'timeline';

const jsonEqual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * List + search + detail-aside, shared by the feed and profile pages.
 * All state lives in the URL: search filters, `view=table`, `tab=…`, and `summaryId=…` for the open detail.
 */
@Component({
  selector: 'app-summary-browser',
  imports: [AltKeyDirective, 
    NgTemplateOutlet,
    FormsModule,
    NzButtonModule,
    NzEmptyModule,
    NzIconModule,
    NzRadioModule,
    NzTabsModule,
    ResizablePageComponent,
    ScrollRailComponent,
    SummarySearchComponent,
    SummaryListComponent,
    SumaroonTimelineComponent,
    SummariesTableComponent,
    SummaryDetailComponent,
    SortRowComponent,
    SummaryActionsBarComponent,
  ],
  providers: [SummaryListStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './summary-browser.component.html',
  styleUrl: './summary-browser.component.scss',
})
export class SummaryBrowserComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly store = inject(SummaryListStore);

  /** Whose summaries: the feed passes the logged-in user, the profile passes the profile owner. */
  readonly ownerId = input.required<string>();
  readonly isProfile = input(false);
  readonly showTabs = input(false);
  readonly showBell = input(true);
  readonly searchPlaceholder = input('חיפוש תמציות');
  /** List this collection's summaries instead of the owner's feed. */
  readonly collection = input<ICollection | null>(null);
  /** Excel template download + upload in the toolbar (feed). */
  readonly excelActions = input(false);
  /** Show the open summary in a side panel. Off when the host page shows `summaryId` itself (hierarchy). */
  readonly detailAside = input(true);
  /** List this running summary's sumaroons. */
  readonly runningId = input<string | null>(null);
  /** Route prefix for the side panel's full-screen button (the open summary's id is appended). */
  readonly fullScreenBase = input<string[] | null>(null);
  /** Pin the projected [browser-header] under the search row while the list scrolls. */
  readonly stickyHeader = input(false);
  /** Feed: bundle sumaroons of the same running summary into one row — only while nothing is searched or filtered. */
  readonly groupSumaroons = input(false);

  readonly tabs = TABS;
  private readonly params = toSignal(this.route.queryParams, { initialValue: {} as Params });

  readonly search = computed<ISummarySearch>(() => searchFromParams(this.params()), { equal: jsonEqual });
  readonly tab = computed<SummarySearch>(() => (this.showTabs() && (this.params()['tab'] as SummarySearch)) || SummarySearch.Summary);
  readonly tabIndex = computed(() => TABS.findIndex((t) => t.value === this.tab()));
  readonly openId = computed<string | null>(() => this.params()['summaryId'] ?? null);
  /** A running summary opens on its timeline; elsewhere the card list is the default. */
  private readonly defaultView = computed<View>(() => (this.runningId() ? 'timeline' : 'list'));
  readonly view = computed<View>(() => {
    const v = this.params()['view'];
    if (v === 'table' || v === 'list') return v;
    if (v === 'timeline' && this.runningId()) return 'timeline';
    return this.defaultView();
  });
  /** A running summary reads in order: earliest first by default. */
  private readonly defaultSort = computed<SortKey>(() => (this.runningId() ? 'eventDate' : DEFAULT_SORT));
  readonly sort = computed<SortKey>(() => this.search().sort ?? this.defaultSort());
  /** The search with its effective sort filled in (the timeline numbers and groups by it). */
  readonly sortedSearch = computed<ISummarySearch>(() => ({ ...this.search(), sort: this.sort() }));
  /** Grouping hides individual sumaroons, so it's off as soon as anything is searched or filtered. */
  readonly groupActive = computed(() => {
    if (!this.groupSumaroons() || this.tab() !== SummarySearch.Summary) return false;
    const s = this.search();
    const filled = (v: unknown) => (Array.isArray(v) ? v.length > 0 : !!v);
    return ![s.text, s.labels, s.users, s.contentTypes, s.colors, s.dates, s.createdDates, s.collections, s.department, s.kinds].some(filled);
  });

  constructor() {
    effect(() => {
      const tab = this.tab();
      const query = {
        ownerId: this.ownerId(),
        collectionId: this.collection()?._id ?? null,
        search: {
          ...this.search(),
          ...(this.runningId() ? { parentId: this.runningId()!, kinds: [SummaryKind.Sumaroon] } : {}),
          sort: this.sort(),
          isProfile: this.isProfile(),
          summarySearch: tab,
          isTagged: tab === SummarySearch.Tagged,
        },
      };
      untracked(() => this.store.load(query));
    });
  }

  /**
   * Scroll-rail label: the date of the summary at viewport y — the date the list is sorted by
   * (event date by default; created/modified when sorting by those; event date for title sort).
   */
  readonly dateLabelAt = (clientY: number): string | null => {
    const s = this.summaryAt(clientY);
    if (!s) return null;
    const field = this.sort().replace('-', '');
    const value = field === 'creationDate' || field === 'modifyDate' ? s[field] : (s.eventDate ?? s.creationDate);
    return value ? format(new Date(value), 'd בMMMM yyyy', { locale: he }) : null;
  };

  /** The card/row under viewport y; probes a little up and down so gaps and date dividers still resolve. */
  private summaryAt(clientY: number): ISummary | null {
    const list = this.host.nativeElement.querySelector('app-summary-list, app-summaries-table');
    if (!list) return null;
    const rect = list.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    for (const dy of [0, 12, -12, 28, -28, 48, -48, 72, -72]) {
      const id = document.elementFromPoint(x, clientY + dy)?.closest('[data-summary-id]')?.getAttribute('data-summary-id');
      if (id) return this.store.summaries().find((s) => s._id === id) ?? null;
    }
    return null;
  }

  onSearch(s: ISummarySearch) {
    this.patchParams(searchToParams(s));
  }

  onSort(sort: SortKey) {
    // searchToParams drops the app-wide default sort, which isn't the default inside a running summary.
    this.patchParams({ ...searchToParams({ ...this.search(), sort }), sort: sort === this.defaultSort() ? null : sort });
  }

  setView(view: View) {
    this.patchParams({ view: view === this.defaultView() ? null : view });
  }

  setTab(index: number) {
    const tab = TABS[index].value;
    this.patchParams({ tab: tab === SummarySearch.Summary ? null : tab });
  }

  /** Eye toggle: open in the aside, or close if already open. A running summary has its own page. */
  toggle(s: ISummary) {
    if (s.kind === SummaryKind.Running) this.router.navigate(['/running', s._id]);
    else this.patchParams({ summaryId: s._id === this.openId() ? null : s._id });
  }

  fullScreenLink(id: string): string[] | null {
    const base = this.fullScreenBase();
    return base ? [...base, id] : null;
  }

  close() {
    this.patchParams({ summaryId: null });
  }

  private patchParams(queryParams: Params) {
    this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge' });
  }
}
