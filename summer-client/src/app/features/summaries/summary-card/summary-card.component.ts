import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzDropDownModule } from 'ng-zorro-antd/dropdown';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzPopoverModule } from 'ng-zorro-antd/popover';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { UserService } from '../../../core/auth/user.service';
import { CapsuleCatchComponent } from '../../../shared/components/capsules/capsule-catch/capsule-catch.component';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { ColorPickerComponent } from '../../../shared/components/color-picker/color-picker.component';
import { ContentTypeIconComponent } from '../../../shared/components/content-type-icon/content-type-icon.component';
import { ISummary, ISummarySearch, SearchType, SummaryKind } from '../../../shared/models';
import { colorGlow } from '../../../shared/models/colors';
import { SUMMARY_DRAG_TYPE, hierarchyParams } from '../../../shared/services/folder.service';
import { DateFormatPipe, HighlightPipe, RelativeTimePipe, RichHtmlPipe } from '../../../shared/pipes/pipes';
import { FolderInfoComponent } from '../folder-info/folder-info.component';
import { MatchSnippetsComponent } from '../match-snippets/match-snippets.component';
import { DeferredClick } from '../deferred-click';
import { SummaryActionsService } from '../summary-actions.service';
import { SummaryListStore } from '../summary-list.store';

const VISIBLE_LABELS = 4;
/** Controls inside the card that do their own thing instead of opening it. */
const INTERACTIVE = 'a, button, label, input, nz-tag, app-color-picker, [nz-dropdown]';

@Component({
  selector: 'app-summary-card',
  imports: [
    RouterLink,
    NzCheckboxModule,
    NzDropDownModule,
    NzIconModule,
    NzPopoverModule,
    NzTagModule,
    NzToolTipModule,
    AvatarComponent,
    CapsuleCatchComponent,
    ColorPickerComponent,
    ContentTypeIconComponent,
    FolderInfoComponent,
    DateFormatPipe,
    RelativeTimePipe,
    HighlightPipe,
    RichHtmlPipe,
    MatchSnippetsComponent,
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
  private readonly route = inject(ActivatedRoute);
  readonly actions = inject(SummaryActionsService);
  readonly hierarchyParams = hierarchyParams;
  private readonly store = inject(SummaryListStore, { optional: true });

  readonly summary = input.required<ISummary>();
  readonly search = input<ISummarySearch | null>(null);
  readonly active = input(false);
  readonly focused = input(false);
  readonly selectable = input(false);
  readonly selected = input(false);
  readonly toggleOpen = output<ISummary>();
  readonly selectToggle = output<string>();

  private readonly pendingSelect = new DeferredClick();

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
  /** One folder on the card; the rest behind a "+N". */
  readonly visibleFolders = computed(() => this.summary().folders.slice(0, 1));
  readonly hiddenFolders = computed(() => this.summary().folders.slice(1));

  /** Can be dragged onto a folder in the tree to add it there (another pointer, so anyone who sees it may): published, not a sumaroon. */
  readonly placeable = computed(() => {
    const s = this.summary();
    return !s.isDraft && s.kind !== SummaryKind.Sumaroon;
  });

  onDragStart(e: DragEvent) {
    const s = this.summary();
    if (!e.dataTransfer) return;
    e.dataTransfer.setData(SUMMARY_DRAG_TYPE, JSON.stringify({ _id: s._id, title: s.title }));
    e.dataTransfer.setData('text/plain', s.title);
    e.dataTransfer.effectAllowed = 'copy';
  }

  /** A sumaroon's running summary has its own page. */
  openParent(id: string) {
    if (this.store?.runningInPlace()) this.router.navigate([], { relativeTo: this.route, queryParams: { runningId: id, summaryId: null }, queryParamsHandling: 'merge' });
    else this.router.navigate(['/running', id]);
  }

  /**
   * Anywhere on the card opens it, except its own controls and when the user is selecting text.
   * In select mode a click toggles its selection instead; ctrl/cmd-click or a double-click opens it.
   */
  onCardClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (target.closest(INTERACTIVE) && !target.closest('.body')) return;
    if (this.selectable()) {
      if (event.ctrlKey || event.metaKey) this.toggleOpen.emit(this.summary());
      // Waits out a possible double-click; its second click is left to onCardDblClick.
      else if (event.detail === 1 && !window.getSelection()?.toString()) this.pendingSelect.run(() => this.selectToggle.emit(this.summary()._id));
      return;
    }
    if (window.getSelection()?.toString()) return;
    this.toggleOpen.emit(this.summary());
  }

  /** In select mode a double-click opens the card and leaves its selection as it was. */
  onCardDblClick(event: MouseEvent) {
    if (!this.selectable() || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (target.closest(INTERACTIVE) && !target.closest('.body')) return;
    window.getSelection()?.removeAllRanges();
    // A slow double-click's first click already toggled; undo it.
    if (!this.pendingSelect.cancel()) this.selectToggle.emit(this.summary()._id);
    this.toggleOpen.emit(this.summary());
  }

  searchLabel(name: string, event: Event) {
    event.stopPropagation();
    this.router.navigate(['/summaries'], { queryParams: { q: name, in: SearchType.Label } });
  }
}
