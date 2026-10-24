import { ChangeDetectionStrategy, Component, computed, effect, inject, input, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzTabsModule } from 'ng-zorro-antd/tabs';
import { FormsModule } from '@angular/forms';
import { ResizablePageComponent } from '../../../shared/components/resizable-page.component';
import { ICollection, ISummary, ISummarySearch, SortKey, SummarySearch } from '../../../shared/models';
import { DEFAULT_SORT, searchFromParams, searchToParams } from '../search-query';
import { SortRowComponent } from '../sort-row.component';
import { SummaryActionsBarComponent } from '../summary-actions-bar.component';
import { SummariesTableComponent } from '../summaries-table/summaries-table.component';
import { SummaryDetailComponent } from '../summary-detail/summary-detail.component';
import { SummaryListStore } from '../summary-list.store';
import { SummaryListComponent } from '../summary-list/summary-list.component';
import { SummarySearchComponent } from '../summary-search/summary-search.component';

const TABS: { value: SummarySearch; label: string; key: 'summary' | 'draft' | 'tagged' | 'favorite' }[] = [
  { value: SummarySearch.Summary, label: 'סיכומים', key: 'summary' },
  { value: SummarySearch.Draft, label: 'טיוטות', key: 'draft' },
  { value: SummarySearch.Tagged, label: 'תיוגים', key: 'tagged' },
  { value: SummarySearch.Favorite, label: 'מועדפים', key: 'favorite' },
];

const jsonEqual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * List + search + detail-aside, shared by the feed and profile pages.
 * All state lives in the URL: search filters, `view=table`, `tab=…`, and `summaryId=…` for the open detail.
 */
@Component({
  selector: 'app-summary-browser',
  imports: [
    FormsModule,
    NzButtonModule,
    NzEmptyModule,
    NzIconModule,
    NzRadioModule,
    NzTabsModule,
    ResizablePageComponent,
    SummarySearchComponent,
    SummaryListComponent,
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
  readonly store = inject(SummaryListStore);

  /** Whose summaries: the feed passes the logged-in user, the profile passes the profile owner. */
  readonly ownerId = input.required<string>();
  readonly isProfile = input(false);
  readonly showTabs = input(false);
  readonly showBell = input(true);
  readonly searchPlaceholder = input('חיפוש סיכומים');
  /** List this collection's summaries instead of the owner's feed. */
  readonly collection = input<ICollection | null>(null);
  /** Excel template download + upload in the toolbar (feed). */
  readonly excelActions = input(false);

  readonly tabs = TABS;
  private readonly params = toSignal(this.route.queryParams, { initialValue: {} as Params });

  readonly search = computed<ISummarySearch>(() => searchFromParams(this.params()), { equal: jsonEqual });
  readonly tab = computed<SummarySearch>(() => (this.showTabs() && (this.params()['tab'] as SummarySearch)) || SummarySearch.Summary);
  readonly tabIndex = computed(() => TABS.findIndex((t) => t.value === this.tab()));
  readonly openId = computed<string | null>(() => this.params()['summaryId'] ?? null);
  readonly view = computed<'list' | 'table'>(() => (this.params()['view'] === 'table' ? 'table' : 'list'));
  readonly sort = computed<SortKey>(() => this.search().sort ?? DEFAULT_SORT);

  constructor() {
    effect(() => {
      const tab = this.tab();
      const query = {
        ownerId: this.ownerId(),
        collectionId: this.collection()?._id ?? null,
        search: {
          ...this.search(),
          sort: this.sort(),
          isProfile: this.isProfile(),
          summarySearch: tab,
          isTagged: tab === SummarySearch.Tagged,
        },
      };
      untracked(() => this.store.load(query));
    });
  }

  onSearch(s: ISummarySearch) {
    this.patchParams(searchToParams(s));
  }

  onSort(sort: SortKey) {
    this.patchParams(searchToParams({ ...this.search(), sort }));
  }

  setView(view: 'list' | 'table') {
    this.patchParams({ view: view === 'table' ? 'table' : null });
  }

  setTab(index: number) {
    const tab = TABS[index].value;
    this.patchParams({ tab: tab === SummarySearch.Summary ? null : tab });
  }

  /** Eye toggle: open in the aside, or close if already open. */
  toggle(s: ISummary) {
    this.patchParams({ summaryId: s._id === this.openId() ? null : s._id });
  }

  close() {
    this.patchParams({ summaryId: null });
  }

  private patchParams(queryParams: Params) {
    this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge' });
  }
}
