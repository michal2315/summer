import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzDropDownModule } from 'ng-zorro-antd/dropdown';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { UserService } from '../../../core/auth/user.service';
import { AvatarComponent } from '../../../shared/components/avatar.component';
import { ColorPickerComponent } from '../../../shared/components/color-picker.component';
import { ContentTypeIconComponent } from '../../../shared/components/content-type-icon.component';
import { ISummary, ISummarySearch, SearchType } from '../../../shared/models';
import { colorGlow } from '../../../shared/models/colors';
import { DateFormatPipe, HighlightPipe, RichHtmlPipe } from '../../../shared/pipes/pipes';
import { SummaryActionsService } from '../summary-actions.service';

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
    HighlightPipe,
    RichHtmlPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './summary-card.component.html',
  styleUrl: './summary-card.component.scss',
  host: {
    '[class.active]': 'active()',
    '[class.focused]': 'focused()',
    '[style.--stripe]': 'summary().color || "transparent"',
  },
})
export class SummaryCardComponent {
  private readonly users = inject(UserService);
  private readonly router = inject(Router);
  readonly actions = inject(SummaryActionsService);

  readonly summary = input.required<ISummary>();
  readonly search = input<ISummarySearch | null>(null);
  readonly active = input(false);
  readonly focused = input(false);
  readonly selectable = input(false);
  readonly selected = input(false);
  readonly toggleOpen = output<ISummary>();
  readonly selectToggle = output<string>();

  readonly T = SearchType;
  readonly glow = colorGlow;
  readonly isMine = computed(() => this.summary().user?._id === this.users.userId());
  readonly seen = computed(() => this.summary().seenBy?.includes(this.users.userId() ?? ''));
  readonly visibleLabels = computed(() => this.summary().labels.slice(0, VISIBLE_LABELS));
  readonly hiddenLabels = computed(() => this.summary().labels.slice(VISIBLE_LABELS));

  searchLabel(name: string, event: Event) {
    event.stopPropagation();
    this.router.navigate(['/summaries'], { queryParams: { q: name, in: SearchType.Label } });
  }
}
