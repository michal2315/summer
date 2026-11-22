import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { APP_CONFIG } from '../../../core/config/app-config';
import { ColorPickerComponent } from '../../../shared/components/color-picker/color-picker.component';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { ISummary, ISummarySearch, SearchType } from '../../../shared/models';
import { DateFormatPipe, HighlightPipe, PlainTextPipe } from '../../../shared/pipes/pipes';
import { DeferredClick } from '../deferred-click';
import { SummaryActionsService } from '../summary-actions.service';
import { SummaryListStore } from '../summary-list.store';

const SEARCH_TYPE_BY_FIELD: Record<string, SearchType> = { title: SearchType.Title, content: SearchType.Content, notes: SearchType.Notes };

/** Columns come from config (summariesTableFields). Server-side paging over the same search endpoint. */
@Component({
  selector: 'app-summaries-table',
  host: { '[class.loading]': 'store.loading()' },
  imports: [NzTableModule, NzButtonModule, NzIconModule, NzToolTipModule, ColorPickerComponent, SkeletonComponent, DateFormatPipe, HighlightPipe, PlainTextPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './summaries-table.component.html',
  styleUrl: './summaries-table.component.scss',
})
export class SummariesTableComponent {
  readonly store = inject(SummaryListStore);
  readonly actions = inject(SummaryActionsService);
  readonly columns = inject(APP_CONFIG).summariesTableFields;
  /** Placeholder rows while a page loads. */
  readonly skeletonRows = Array.from({ length: 8 }, (_, i) => i);
  readonly allChecked = computed(() => this.store.summaries().length > 0 && this.store.summaries().every((s) => this.store.selected().has(s._id)));
  readonly someChecked = computed(() => !this.allChecked() && this.store.summaries().some((s) => this.store.selected().has(s._id)));

  readonly search = input<ISummarySearch | null>(null);
  readonly openId = input<string | null>(null);
  readonly toggle = output<ISummary>();
  private readonly pendingSelect = new DeferredClick();

  /** In select mode a click toggles the row's selection; ctrl/cmd-click or a double-click opens it. */
  onRowClick(s: ISummary, event: MouseEvent) {
    if (!this.store.selectMode() || event.ctrlKey || event.metaKey) {
      this.toggle.emit(s);
      return;
    }
    // Waits out a possible double-click; its second click is left to onRowDblClick.
    if (event.detail === 1 && !window.getSelection()?.toString()) this.pendingSelect.run(() => this.store.toggleSelected(s._id));
  }

  /** Opens the row and leaves its selection as it was. */
  onRowDblClick(s: ISummary, event: MouseEvent) {
    if (!this.store.selectMode() || event.ctrlKey || event.metaKey) return;
    window.getSelection()?.removeAllRanges();
    // A slow double-click's first click already toggled; undo it.
    if (!this.pendingSelect.cancel()) this.store.toggleSelected(s._id);
    this.toggle.emit(s);
  }

  field(s: ISummary, name: string): string {
    return String((s as unknown as Record<string, unknown>)[name] ?? '');
  }

  typeFor(name: string): SearchType {
    return SEARCH_TYPE_BY_FIELD[name] ?? SearchType.Title;
  }
}
