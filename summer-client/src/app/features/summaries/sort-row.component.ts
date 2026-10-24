import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { SortKey } from '../../shared/models';

type Field = 'eventDate' | 'creationDate' | 'modifyDate' | 'title';

const FIELDS: { value: Field; label: string }[] = [
  { value: 'eventDate', label: 'תאריך האירוע' },
  { value: 'creationDate', label: 'תאריך יצירה' },
  { value: 'modifyDate', label: 'עדכון אחרון' },
  { value: 'title', label: 'כותרת' },
];

/** Sort field + asc/desc toggle. '-field' = descending. */
@Component({
  selector: 'app-sort-row',
  imports: [FormsModule, NzSelectModule, NzButtonModule, NzIconModule, NzToolTipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="muted">מיון:</span>
    <nz-select nzSize="small" [ngModel]="field()" (ngModelChange)="emit($event, desc())" [nzBorderless]="true" aria-label="שדה מיון">
      @for (f of fields; track f.value) {
        <nz-option [nzValue]="f.value" [nzLabel]="f.label" />
      }
    </nz-select>
    <button nz-button nzType="text" nzSize="small" (click)="emit(field(), !desc())" [nz-tooltip]="desc() ? 'סדר יורד' : 'סדר עולה'" aria-label="כיוון מיון">
      <span nz-icon [nzType]="desc() ? 'sort-descending' : 'sort-ascending'"></span>
    </button>
  `,
  styles: `
    :host { display: inline-flex; align-items: center; gap: 2px; font-size: 14px; }
    nz-select { min-width: 120px; }
  `,
})
export class SortRowComponent {
  readonly sort = input<SortKey>('-eventDate');
  readonly sortChange = output<SortKey>();
  readonly fields = FIELDS;

  readonly desc = computed(() => this.sort().startsWith('-'));
  readonly field = computed(() => this.sort().replace('-', '') as Field);

  emit(field: Field, desc: boolean) {
    this.sortChange.emit((desc ? `-${field}` : field) as SortKey);
  }
}
