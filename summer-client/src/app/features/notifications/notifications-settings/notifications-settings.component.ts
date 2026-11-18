import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { NzPopoverModule } from 'ng-zorro-antd/popover';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzSwitchModule } from 'ng-zorro-antd/switch';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { Observable } from 'rxjs';
import { StorageService } from '../../../core/storage/storage.service';
import { NotificationBellComponent } from '../../../shared/components/notification-bell/notification-bell.component';
import { PreferencesButtonComponent } from '../../../shared/components/preferences/preferences-button.component';
import { InViewDirective } from '../../../shared/components/in-view.directive';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { IQuery } from '../../../shared/models';
import { QueryService } from '../../../shared/services/query.service';
import { renderPages } from '../../../shared/utils/render-pages';
import { QUERY_KIND_LABEL, describeSearch } from '../../summaries/search-query';
import { SummaryDetailComponent } from '../../summaries/summary-detail/summary-detail.component';
import { MyQueriesComponent } from '../my-queries/my-queries.component';
import { NotificationFeedComponent } from '../notification-feed/notification-feed.component';
import { SharedQueriesComponent } from '../shared-queries/shared-queries.component';
import { NotificationsSettingsService } from '../notification-rules';

const PANEL_KEY = 'notificationsPanelCollapsed';
const TAB_KEY = 'notificationsPanelTab';

type PanelTab = 'alerts' | 'mine' | 'shared';
const TABS: { key: PanelTab; label: string; icon: string }[] = [
  { key: 'alerts', label: 'התראות', icon: 'bell' },
  { key: 'mine', label: 'החיפושים שלי', icon: 'save' },
  { key: 'shared', label: 'משותפים', icon: 'team' },
];

/**
 * /notifications — a feed of every notification about a summary (with the summary), beside a panel of searches and
 * alerts in tabs: the alerts (with the e-mail switches), the user's own saved searches, and others' shared ones. An alert is on a saved search (a query): the panel lists the queries
 * that alert, finds any saved search to start alerting on, pauses, edits and cancels. Picking one narrows the feed.
 */
@Component({
  selector: 'app-notifications-settings',
  imports: [
    FormsModule,
    RouterLink,
    NzButtonModule,
    NzCheckboxModule,
    NzEmptyModule,
    NzIconModule,
    NzInputModule,
    NzPopconfirmModule,
    NzPopoverModule,
    NzSelectModule,
    NzSwitchModule,
    NzTagModule,
    NzToolTipModule,
    InViewDirective,
    NotificationBellComponent,
    PreferencesButtonComponent,
    MyQueriesComponent,
    NotificationFeedComponent,
    SharedQueriesComponent,
    SummaryDetailComponent,
    SkeletonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './notifications-settings.component.html',
  styleUrl: './notifications-settings.component.scss',
})
export class NotificationsSettingsComponent {
  readonly service = inject(NotificationsSettingsService);
  readonly queries = inject(QueryService);
  private readonly message = inject(NzMessageService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  private readonly storage = inject(StorageService);

  readonly describe = describeSearch;
  readonly kindLabel = QUERY_KIND_LABEL;

  /** The management panel folded to a slim strip, giving the feed the room. */
  readonly panelCollapsed = signal(this.storage.get<boolean>(PANEL_KEY) === true);

  readonly tabs = TABS;
  readonly tab = signal<PanelTab>(TABS.some((t) => t.key === this.storage.get<string>(TAB_KEY)) ? this.storage.get<PanelTab>(TAB_KEY)! : 'alerts');
  tabCount(tab: PanelTab): number {
    return tab === 'alerts' ? this.queries.alerting().length : tab === 'mine' ? this.queries.queries().length : 0;
  }

  setTab(tab: PanelTab) {
    this.tab.set(tab);
    this.storage.set(TAB_KEY, tab);
  }

  readonly filter = signal('');
  readonly filtered = computed(() => {
    const q = this.filter().trim();
    const list = this.queries.alerting();
    return q ? list.filter((r) => r.name.includes(q) || describeSearch(r.search).includes(q)) : list;
  });
  /** Rendered a page at a time; a new filter starts over. */
  readonly page = renderPages(this.filtered, 30, this.filter);

  /** "Alert on a saved search": the saved searches that don't alert yet, by name. */
  readonly addText = signal('');
  readonly addOptions = computed(() =>
    this.queries.search(
      this.addText(),
      12,
      this.queries.queries().filter((q) => !q.alert),
    ),
  );
  readonly busy = signal(new Set<string>());

  /** The query the feed is narrowed to; null shows every notification. */
  readonly queryId = signal<string | null>(null);
  readonly queryName = computed(() => this.queries.byId(this.queryId())?.name ?? null);

  /** ?tab= — open on a tab (links from elsewhere, e.g. the profile). */
  readonly tabParam = input<string | undefined>(undefined, { alias: 'tab' });

  /** ?summaryId= — the summary opened from the feed, shown in its place (browser back works too). */
  readonly summaryId = input<string>();
  /** ?alertQuery= — the query whose alert opened it: what the summary highlights. */
  readonly alertQuery = input<string>();
  readonly highlight = computed(() => this.queries.byId(this.alertQuery())?.search ?? null);
  private readonly mainEl = viewChild<ElementRef<HTMLElement>>('main');
  /** The feed's scroll position when a summary was opened, restored on the way back. */
  private feedScroll = 0;

  constructor() {
    this.queries.ensureLoaded();
    this.service.loadPreferences();
    effect(() => {
      const t = this.tabParam();
      if (TABS.some((x) => x.key === t)) untracked(() => this.setTab(t as PanelTab));
    });
    // Opening shows the summary from its top; closing puts the feed back where it was.
    effect(() => {
      const open = !!this.summaryId();
      const el = untracked(() => this.mainEl()?.nativeElement);
      if (el) afterNextRender(() => (el.scrollTop = open ? 0 : this.feedScroll), { injector: this.injector });
    });
  }

  open(opened: { summaryId: string; queryId?: string }, main: HTMLElement) {
    this.feedScroll = main.scrollTop;
    this.router.navigate([], { relativeTo: this.route, queryParams: { summaryId: opened.summaryId, alertQuery: opened.queryId ?? null }, queryParamsHandling: 'merge' });
  }

  togglePanel() {
    this.panelCollapsed.update((v) => !v);
    this.storage.set(PANEL_KEY, this.panelCollapsed());
  }

  back() {
    this.router.navigate([], { relativeTo: this.route, queryParams: { summaryId: null, alertQuery: null }, queryParamsHandling: 'merge' });
  }

  /** Picking the picked query again goes back to all notifications. */
  pick(q: IQuery) {
    this.queryId.update((id) => (id === q._id ? null : q._id));
  }

  /** Start alerting on a saved search picked from the list. */
  activate(id: string | null) {
    const q = this.queries.byId(id);
    if (!q) return;
    this.addText.set('');
    this.track(q, this.queries.setAlert(q._id, { isActive: true }), () => this.message.success(`תתקבל התראה על תמציות חדשות שמתאימות ל"${q.name}"`));
  }

  /** Pause or resume. */
  setActive(q: IQuery, isActive: boolean) {
    this.track(q, this.queries.setAlert(q._id, { isActive }), () => {});
  }

  /** Mail settings of an alert on someone else's query (their search can't be edited here). */
  setChannel(q: IQuery, key: 'isMail' | 'isDigest', on: boolean) {
    this.track(q, this.queries.setAlert(q._id, { [key]: on }), () => {});
  }

  /** Stop alerting; the saved search stays. */
  cancel(q: IQuery) {
    this.track(q, this.queries.removeAlert(q._id), () => {
      if (this.queryId() === q._id) this.queryId.set(null);
      this.message.success(q.isMine ? 'ההתראה בוטלה — החיפוש נשאר בחיפושים השמורים' : 'ההתראה על החיפוש המשותף בוטלה');
    });
  }

  isBusy(q: IQuery) {
    return this.busy().has(q._id);
  }

  private track(q: IQuery, req: Observable<unknown>, next: () => void) {
    const set = (on: boolean) =>
      this.busy.update((b) => {
        const copy = new Set(b);
        if (on) copy.add(q._id);
        else copy.delete(q._id);
        return copy;
      });
    set(true);
    req.subscribe({ next, error: () => set(false), complete: () => set(false) });
  }
}
