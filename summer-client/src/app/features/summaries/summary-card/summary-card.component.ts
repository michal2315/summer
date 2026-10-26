import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzDropDownModule } from 'ng-zorro-antd/dropdown';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { UserService } from '../../../core/auth/user.service';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { ColorPickerComponent } from '../../../shared/components/color-picker/color-picker.component';
import { ContentTypeIconComponent } from '../../../shared/components/content-type-icon/content-type-icon.component';
import { ISummary, ISummarySearch, SearchType, SummaryKind } from '../../../shared/models';
import { colorGlow } from '../../../shared/models/colors';
import { DateFormatPipe, HighlightPipe, RelativeTimePipe, RichHtmlPipe } from '../../../shared/pipes/pipes';
import { SummaryActionsService } from '../summary-actions.service';
import { SummaryListStore } from '../summary-list.store';

const VISIBLE_LABELS = 4;

@Component({
  selector: 'app-summary-card',
  imports: [
    RouterLink,
    NzCheckboxModule,
    NzDropDownModule,
    NzIconModule,
    NzTagModule,
    NzToolTipModule,
    AvatarComponent,
    ColorPickerComponent,
    ContentTypeIconComponent,
    DateFormatPipe,
    RelativeTimePipe,
    HighlightPipe,
    RichHtmlPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './summary-card.component.html',
  styleUrl: './summary-card.component.scss',
  host: {
    '[class.active]': 'active()',
    '[class.focused]': 'focused()',
    '[class.running]': 'summary().kind === "running"',
    '[style.--stripe]': 'summary().color || "transparent"',
  },
})
export class SummaryCardComponent {
  private readonly users = inject(UserService);
  private readonly router = inject(Router);
  readonly actions = inject(SummaryActionsService);
  private readonly store = inject(SummaryListStore, { optional: true });

  readonly summary = input.required<ISummary>();
  readonly search = input<ISummarySearch | null>(null);
  readonly active = input(false);
  readonly focused = input(false);
  readonly selectable = input(false);
  readonly selected = input(false);
  readonly toggleOpen = output<ISummary>();
  readonly selectToggle = output<string>();

  readonly T = SearchType;
  readonly K = SummaryKind;
  /** Hidden when the list is this sumaroon's own running summary (the page header already says so). */
  readonly showParent = computed(() => {
    const s = this.summary();
    return !!s.parent && this.store?.currentQuery()?.search.parentId !== s.parentId;
  });
  readonly glow = colorGlow;
  readonly isMine = computed(() => this.summary().user?._id === this.users.userId());
  /** Someone else's summary this user hasn't opened yet. */
  readonly unread = computed(() => !this.isMine() && !this.summary().seenBy?.includes(this.users.userId() ?? ''));
  readonly visibleLabels = computed(() => this.summary().labels.slice(0, VISIBLE_LABELS));
  readonly hiddenLabels = computed(() => this.summary().labels.slice(VISIBLE_LABELS));

  /** A sumaroon's running summary has its own page. */
  openParent(id: string) {
    this.router.navigate(['/running', id]);
  }

  searchLabel(name: string, event: Event) {
    event.stopPropagation();
    this.router.navigate(['/summaries'], { queryParams: { q: name, in: SearchType.Label } });
  }
}
