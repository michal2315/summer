import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { Subscription } from 'rxjs';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { InViewDirective } from '../../../shared/components/in-view.directive';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { StorageService } from '../../../core/storage/storage.service';
import { INotificationFeedItem, NotificationKind } from '../../../shared/models';
import { DateFormatPipe, RelativeTimePipe } from '../../../shared/pipes/pipes';
import { NotificationService } from '../../../shared/services/notification.service';
import { CapsuleService } from '../../../shared/services/capsule.service';
import { SummaryCardComponent } from '../../summaries/summary-card/summary-card.component';
import { NotificationsSettingsService, describeRule, ruleCapsuleIds, ruleHighlight } from '../notification-rules';

interface FeedPage {
  items: INotificationFeedItem[];
  hasMore: boolean;
}

/** The filter chips, in order, with each kind's icon on the feed. */
const KIND_OPTIONS: { kind: NotificationKind; label: string; icon: string }[] = [
  { kind: 'rule', label: 'כללי התראה', icon: 'notification' },
  { kind: 'search', label: 'חיפושים שמורים', icon: 'search' },
  { kind: 'tag', label: 'תיוגים', icon: 'tag' },
  { kind: 'comment', label: 'תגובות', icon: 'message' },
  { kind: 'mention', label: 'אזכורים', icon: 'user' },
  { kind: 'follow', label: 'אנשים שאני עוקב/ת אחריהם', icon: 'team' },
];
const KIND_ICON = new Map(KIND_OPTIONS.map((o) => [o.kind, o.icon]));
const KINDS_KEY = 'notificationFeedKinds';
const UNREAD_KEY = 'notificationFeedUnread';
const ACTIVITY_VERB: Partial<Record<NotificationKind, string>> = {
  tag: 'תייג/ה',
  comment: 'הגיב/ה',
  mention: 'הזכיר/ה בתגובה',
  follow: 'פרסם/ה תמצית חדשה',
};

/** The notifications page feed: every notification about a summary, newest first, each with that summary's card. */
@Component({
  selector: 'app-notification-feed',
  imports: [NzButtonModule, NzEmptyModule, NzIconModule, NzToolTipModule, InViewDirective, SkeletonComponent, SummaryCardComponent, DateFormatPipe, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './notification-feed.component.html',
  styleUrl: './notification-feed.component.scss',
})
export class NotificationFeedComponent {
  private readonly http = inject(HttpClient);
  private readonly bell = inject(NotificationService);
  private readonly storage = inject(StorageService);
  private readonly rules = inject(NotificationsSettingsService);
  private readonly capsules = inject(CapsuleService);
  readonly kindIcon = (kind: NotificationKind) => KIND_ICON.get(kind) ?? 'bell';

  /** Only notifications this rule raised; null for all of them. */
  readonly ruleId = input<string | null>(null);
  readonly ruleName = input<string | null>(null);
  readonly clearRule = output<void>();
  readonly pickRule = output<string>();
  /** A summary's card was clicked (the page shows it in place of the feed). */
  readonly opened = output<{ summaryId: string; ruleId?: string }>();

  readonly kindOptions = KIND_OPTIONS;
  /** Kinds shown; empty shows them all. Remembered per browser. */
  readonly kinds = signal<ReadonlySet<NotificationKind>>(new Set(this.storage.get<NotificationKind[]>(KINDS_KEY)?.filter((k) => KIND_OPTIONS.some((o) => o.kind === k)) ?? []));
  /** Only alerts not yet read. Remembered per browser. */
  readonly unreadOnly = signal(this.storage.get<boolean>(UNREAD_KEY) === true);

  readonly items = signal<INotificationFeedItem[]>([]);
  readonly hasMore = signal(false);
  readonly loading = signal(true);
  readonly failed = signal(false);
  readonly unread = computed(() => this.items().some((n) => !n.isViewed));
  private request?: Subscription;

  /** Per rule: what its alerts highlight in the summary, and why it matched (in words). */
  readonly ruleInfo = computed(
    () => new Map((this.rules.rules() ?? []).map((r) => [r._id!, { highlight: ruleHighlight(r), why: describeRule(r) }])),
  );

  constructor() {
    effect(() => {
      this.ruleId();
      this.kinds();
      this.unreadOnly();
      untracked(() => this.load(true));
    });
    // Capsule rules highlight the capsule's words, so the capsules must be known.
    effect(() => {
      const ids = (this.rules.rules() ?? []).flatMap(ruleCapsuleIds);
      if (ids.length) untracked(() => this.capsules.ensure({ ids }));
    });
    inject(DestroyRef).onDestroy(() => this.request?.unsubscribe());
  }

  /** Toggle one kind in or out; "all" (null) clears the filter. */
  toggleKind(kind: NotificationKind | null) {
    const next = new Set(kind ? this.kinds() : []);
    if (kind) {
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
    }
    // Every kind picked is the same as none.
    if (next.size === KIND_OPTIONS.length) next.clear();
    this.kinds.set(next);
    this.storage.set(KINDS_KEY, [...next]);
  }

  toggleUnread() {
    this.unreadOnly.update((v) => !v);
    this.storage.set(UNREAD_KEY, this.unreadOnly());
  }

  more() {
    if (!this.loading() && this.hasMore()) this.load(false);
  }

  private load(reset: boolean) {
    const ruleId = this.ruleId();
    const kinds = [...this.kinds()];
    this.request?.unsubscribe();
    if (reset) {
      this.items.set([]);
      this.hasMore.set(false);
    }
    this.loading.set(true);
    this.failed.set(false);
    // Read ones drop out of the unread-only list on the server, so page past the ones still unread here.
    const loaded = this.unreadOnly() ? this.items().filter((n) => !n.isViewed).length : this.items().length;
    const params: Record<string, string> = { offset: String(reset ? 0 : loaded) };
    if (this.unreadOnly()) params['unread'] = 'true';
    if (ruleId) params['ruleId'] = ruleId;
    if (kinds.length) params['kinds'] = kinds.join(',');
    this.request = this.http.get<FeedPage>('/api/notifications/feed', { params }).subscribe({
      next: (page) => {
        this.items.update((items) => [...items, ...page.items]);
        this.hasMore.set(page.hasMore);
        this.loading.set(false);
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }

  retry() {
    this.load(this.items().length === 0);
  }

  markViewed(n: INotificationFeedItem) {
    if (n.isViewed) return;
    this.bell.markViewed(n._id);
    this.items.update((items) => items.map((i) => (i._id === n._id ? { ...i, isViewed: true } : i)));
  }

  markAllViewed() {
    this.bell.markAllViewed();
    this.items.update((items) => items.map((i) => ({ ...i, isViewed: true })));
  }

  /** Activity in a few words ("דנה לוי תייג/ה אותך"); the full sentence is in the tooltip. */
  shortLabel(n: INotificationFeedItem): string {
    const who = n.createdBy?.fullName;
    if (!who) return n.text;
    return `${who} ${ACTIVITY_VERB[n.kind] ?? ''}`.trim();
  }

  open(n: INotificationFeedItem) {
    this.markViewed(n);
    this.opened.emit({ summaryId: n.summary._id, ruleId: n.rule?._id });
  }
}
