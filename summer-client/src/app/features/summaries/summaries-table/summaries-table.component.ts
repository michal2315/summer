import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { APP_CONFIG } from '../../../core/config/app-config';
import { ColorPickerComponent } from '../../../shared/components/color-picker/color-picker.component';
import { ISummary, ISummarySearch, SearchType } from '../../../shared/models';
import { DateFormatPipe, HighlightPipe, PlainTextPipe } from '../../../shared/pipes/pipes';
import { SummaryActionsService } from '../summary-actions.service';
import { SummaryListStore } from '../summary-list.store';

const SEARCH_TYPE_BY_FIELD: Record<string, SearchType> = { title: SearchType.Title, content: SearchType.Content, notes: SearchType.Notes };

/** Columns come from config (summariesTableFields). Server-side paging over the same search endpoint. */
@Component({
  selector: 'app-summaries-table',
  imports: [NzTableModule, NzButtonModule, NzIconModule, NzToolTipModule, ColorPickerComponent, DateFormatPipe, HighlightPipe, PlainTextPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './summaries-table.component.html',
  styleUrl: './summaries-table.component.scss',
})
export class SummariesTableComponent {
  readonly store = inject(SummaryListStore);
  readonly actions = inject(SummaryActionsService);
  readonly columns = inject(APP_CONFIG).summariesTableFields;
  readonly allChecked = computed(() => this.store.summaries().length > 0 && this.store.summaries().every((s) => this.store.selected().has(s._id)));
  readonly someChecked = computed(() => !this.allChecked() && this.store.summaries().some((s) => this.store.selected().has(s._id)));

  readonly search = input<ISummarySearch | null>(null);
  readonly openId = input<string | null>(null);
  readonly toggle = output<ISummary>();

  field(s: ISummary, name: string): string {
    return String((s as unknown as Record<string, unknown>)[name] ?? '');
  }

  typeFor(name: string): SearchType {
    return SEARCH_TYPE_BY_FIELD[name] ?? SearchType.Title;
  }
}
