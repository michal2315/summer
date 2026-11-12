import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { NzSwitchModule } from 'ng-zorro-antd/switch';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { StorageService } from '../../../core/storage/storage.service';
import { NotificationBellComponent } from '../../../shared/components/notification-bell/notification-bell.component';
import { InViewDirective } from '../../../shared/components/in-view.directive';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { INotificationSettings } from '../../../shared/models';
import { renderPages } from '../../../shared/utils/render-pages';
import { SummaryDetailComponent } from '../../summaries/summary-detail/summary-detail.component';
import { NotificationFeedComponent } from '../notification-feed/notification-feed.component';
import { NotificationNamePipe, NotificationsSettingsService, describeRule, ruleHighlight } from '../notification-rules';

const PANEL_KEY = 'notificationsPanelCollapsed';

/**
 * /notifications — a feed of every notification about a summary (with the summary), beside a management panel:
 * the user's e-mail switches and notification rules (list, filter, edit, delete). Picking a rule narrows the feed to it.
 */
@Component({
  selector: 'app-notifications-settings',
  imports: [
    FormsModule,
    RouterLink,
    NzButtonModule,
    NzEmptyModule,
    NzIconModule,
    NzInputModule,
    NzPopconfirmModule,
    NzSwitchModule,
    NzTagModule,
    NzToolTipModule,
    InViewDirective,
    NotificationBellComponent,
    NotificationFeedComponent,
    SummaryDetailComponent,
    SkeletonComponent,
    NotificationNamePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './notifications-settings.component.html',
  styleUrl: './notifications-settings.component.scss',
})
export class NotificationsSettingsComponent {
  readonly service = inject(NotificationsSettingsService);
  private readonly message = inject(NzMessageService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  private readonly storage = inject(StorageService);

  /** The management panel folded to a slim strip, giving the feed the room. */
  readonly panelCollapsed = signal(this.storage.get<boolean>(PANEL_KEY) === true);

  readonly filtered = computed(() => {
    const q = this.service.filter().trim();
    const rules = this.service.rules() ?? [];
    return q ? rules.filter((r) => r.name.includes(q) || describeRule(r).includes(q)) : rules;
  });
  /** Rendered a page at a time; a new filter starts over. */
  readonly page = renderPages(this.filtered, 30, this.service.filter);

  /** The rule the feed is narrowed to; null shows every notification. */
  readonly ruleId = signal<string | null>(null);
  readonly ruleName = computed(() => {
    const id = this.ruleId();
    return id ? (this.service.rules()?.find((r) => r._id === id)?.name ?? null) : null;
  });

  /** ?summaryId= — the summary opened from the feed, shown in its place (browser back works too). */
  readonly summaryId = input<string>();
  /** ?alertRule= — the rule whose alert opened it: what the summary highlights. */
  readonly alertRule = input<string>();
  readonly highlight = computed(() => {
    const rule = this.alertRule() ? this.service.rules()?.find((r) => r._id === this.alertRule()) : undefined;
    return rule ? ruleHighlight(rule) : null;
  });
  private readonly mainEl = viewChild<ElementRef<HTMLElement>>('main');
  /** The feed's scroll position when a summary was opened, restored on the way back. */
  private feedScroll = 0;

  constructor() {
    this.service.load();
    this.service.loadPreferences();
    // Opening shows the summary from its top; closing puts the feed back where it was.
    effect(() => {
      const open = !!this.summaryId();
      const el = untracked(() => this.mainEl()?.nativeElement);
      if (el) afterNextRender(() => (el.scrollTop = open ? 0 : this.feedScroll), { injector: this.injector });
    });
  }

  open(opened: { summaryId: string; ruleId?: string }, main: HTMLElement) {
    this.feedScroll = main.scrollTop;
    this.router.navigate([], { relativeTo: this.route, queryParams: { summaryId: opened.summaryId, alertRule: opened.ruleId ?? null }, queryParamsHandling: 'merge' });
  }

  togglePanel() {
    this.panelCollapsed.update((v) => !v);
    this.storage.set(PANEL_KEY, this.panelCollapsed());
  }

  back() {
    this.router.navigate([], { relativeTo: this.route, queryParams: { summaryId: null, alertRule: null }, queryParamsHandling: 'merge' });
  }

  /** Picking the picked rule again goes back to all notifications. */
  pick(r: INotificationSettings) {
    this.ruleId.update((id) => (id === r._id ? null : r._id!));
  }

  remove(r: INotificationSettings) {
    this.service.delete(r._id!).subscribe(() => {
      if (this.ruleId() === r._id) this.ruleId.set(null);
      this.message.success('הכלל נמחק');
    });
  }
}
