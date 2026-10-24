import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { APP_CONFIG } from '../../../core/config/app-config';
import { ColorPickerComponent } from '../../../shared/components/color-picker.component';
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
  template: `
    <nz-table
      #table
      [nzData]="store.summaries()"
      [nzFrontPagination]="false"
      [nzTotal]="store.total()"
      [nzPageSize]="store.limit"
      [nzPageIndex]="store.pageIndex()"
      (nzPageIndexChange)="store.goToPage($event)"
      [nzLoading]="store.loading()"
      nzSize="middle"
      [nzScroll]="{ x: '720px' }"
      [nzNoResult]="noResult"
    >
      <thead>
        <tr>
          @if (store.selectMode()) {
            <th nzWidth="44px" [nzChecked]="allChecked()" [nzIndeterminate]="someChecked()" (nzCheckedChange)="store.toggleSelectAllLoaded()" aria-label="בחירת הכל"></th>
          }
          <th nzWidth="48px"></th>
          @for (col of columns; track col.name) {
            <th [nzWidth]="col.width">{{ col.displayName }}</th>
          }
          <th nzWidth="56px"></th>
        </tr>
      </thead>
      <tbody>
        @for (s of table.data; track s._id) {
          <tr [class.active]="s._id === openId()" (click)="toggle.emit(s)">
            @if (store.selectMode()) {
              <td [nzChecked]="store.selected().has(s._id)" (nzCheckedChange)="store.toggleSelected(s._id)" (click)="$event.stopPropagation()"></td>
            }
            <td (click)="$event.stopPropagation()"><app-color-picker [color]="s.color" (colorChange)="actions.setColor(s, $event)" /></td>
            @for (col of columns; track col.name) {
              <td>
                @if (col.type === 'date') {
                  {{ field(s, col.name) | dateFormat: 'dd/MM/yyyy' }}
                } @else {
                  <span class="clamp" [innerHTML]="field(s, col.name) | plainText: 220 | highlight: search() : typeFor(col.name)"></span>
                  @if (col.name === 'content' && s.files.length) {
                    <div class="files"><span nz-icon nzType="paper-clip"></span> {{ s.files.join(', ') }}</div>
                  }
                }
              </td>
            }
            <td>
              <button nz-button nzType="text" nzShape="circle" (click)="$event.stopPropagation(); toggle.emit(s)" [attr.aria-label]="s._id === openId() ? 'סגירה' : 'פתיחה'">
                <span nz-icon [nzType]="s._id === openId() ? 'eye-invisible' : 'eye'"></span>
              </button>
            </td>
          </tr>
        }
      </tbody>
    </nz-table>
    <ng-template #noResult>לא נמצאו תוצאות</ng-template>
  `,
  styles: `
    :host { display: block; background: #fff; border-radius: 12px; padding: 8px; }
    tr { cursor: pointer; }
    tr.active td { background: #fff4f5; }
    .clamp { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .files { font-size: 12px; color: #9b9bb1; margin-top: 4px; }
  `,
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
