import { ChangeDetectionStrategy, Component, computed, forwardRef, inject, signal } from '@angular/core';
import { AbstractControl, ControlValueAccessor, FormsModule, NG_VALIDATORS, NG_VALUE_ACCESSOR, ValidationErrors, Validator } from '@angular/forms';
import { NzDatePickerModule } from 'ng-zorro-antd/date-picker';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { Subject, debounceTime, switchMap } from 'rxjs';
import { FieldsType, IField, INotificationSettingsCondition, NotificationsFunctionsOptions } from '../../shared/models';
import { ContentTypeService } from '../../shared/services/content-type.service';
import { LabelService } from '../../shared/services/label.service';
import { OPTIONS_BY_TYPE, isBetween } from './notification-rules';

type Operand = string | number | Date | null;

/**
 * One rule condition as a form control: field → operator (per field type) → value input typed by the field.
 * *Between operators take two operands; an empty bound is open-ended.
 */
@Component({
  selector: 'app-create-notification-condition',
  imports: [FormsModule, NzDatePickerModule, NzInputModule, NzInputNumberModule, NzSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => CreateNotificationConditionComponent), multi: true },
    { provide: NG_VALIDATORS, useExisting: forwardRef(() => CreateNotificationConditionComponent), multi: true },
  ],
  template: `
    <nz-select class="field" nzShowSearch nzPlaceHolder="שדה" [ngModel]="field()?._id" (ngModelChange)="setField($event)" [nzDisabled]="disabled()" aria-label="שדה">
      @for (f of contentTypes.fields(); track f._id) {
        <nz-option [nzValue]="f._id" [nzLabel]="f.name" />
      }
    </nz-select>

    <nz-select class="op" nzPlaceHolder="תנאי" [ngModel]="funcName()" (ngModelChange)="setFunc($event)" [nzDisabled]="disabled() || !field()" aria-label="תנאי">
      @for (o of options(); track o.value) {
        <nz-option [nzValue]="o.value" [nzLabel]="o.label" />
      }
    </nz-select>

    <span class="value">
      @switch (field()?.type) {
        @case (FT.Number) {
          <nz-input-number [ngModel]="operand(0)" (ngModelChange)="setOperand(0, $event)" [nzPlaceHolder]="between() ? 'מ- (ריק = ללא הגבלה)' : 'ערך'" [nzDisabled]="disabled()" />
          @if (between()) {
            <nz-input-number [ngModel]="operand(1)" (ngModelChange)="setOperand(1, $event)" nzPlaceHolder="עד (ריק = ללא הגבלה)" [nzDisabled]="disabled()" />
          }
        }
        @case (FT.Date) {
          <nz-date-picker [ngModel]="operand(0)" (ngModelChange)="setOperand(0, $event)" nzFormat="dd/MM/yyyy" [nzPlaceHolder]="between() ? 'מתאריך' : 'תאריך'" [nzDisabled]="disabled()" />
          @if (between()) {
            <nz-date-picker [ngModel]="operand(1)" (ngModelChange)="setOperand(1, $event)" nzFormat="dd/MM/yyyy" nzPlaceHolder="עד תאריך" [nzDisabled]="disabled()" />
          }
        }
        @case (FT.Array) {
          <nz-select
            nzMode="tags"
            nzPlaceHolder="ערכים"
            [ngModel]="operands()"
            (ngModelChange)="setAll($event)"
            (nzOnSearch)="labelQuery$.next($event)"
            [nzDisabled]="disabled()"
            aria-label="ערכים"
          >
            @for (l of labelOptions(); track l) {
              <nz-option [nzValue]="l" [nzLabel]="l" />
            }
          </nz-select>
        }
        @default {
          <input nz-input placeholder="ערך" [ngModel]="operand(0)" (ngModelChange)="setOperand(0, $event)" [disabled]="disabled() || !field()" aria-label="ערך" />
        }
      }
    </span>
  `,
  styles: `
    :host { display: grid; grid-template-columns: minmax(0, 1fr) 140px minmax(0, 1.4fr); gap: 8px; align-items: center; flex: 1; min-width: 0; }
    nz-select { width: 100%; }
    .value { display: flex; gap: 6px; min-width: 0; }
    .value > * { flex: 1; min-width: 0; width: 100%; }
    @media (max-width: 768px) { :host { grid-template-columns: 1fr; } }
  `,
})
export class CreateNotificationConditionComponent implements ControlValueAccessor, Validator {
  readonly contentTypes = inject(ContentTypeService);
  private readonly labels = inject(LabelService);
  readonly FT = FieldsType;

  readonly field = signal<IField | null>(null);
  readonly funcName = signal<NotificationsFunctionsOptions | null>(null);
  readonly operands = signal<Operand[]>([]);
  readonly disabled = signal(false);

  readonly options = computed(() => (this.field() ? OPTIONS_BY_TYPE[this.field()!.type] ?? [] : []));
  readonly between = computed(() => isBetween(this.funcName()));

  readonly labelOptions = signal<string[]>([]);
  readonly labelQuery$ = new Subject<string>();

  private onChange: (v: INotificationSettingsCondition | null) => void = () => undefined;
  private onTouched: () => void = () => undefined;
  private onValidatorChange: () => void = () => undefined;

  constructor() {
    this.labelQuery$
      .pipe(
        debounceTime(200),
        switchMap((t) => this.labels.search(t)),
      )
      .subscribe((l) => this.labelOptions.set(l));
    this.labelQuery$.next('');
  }

  operand(i: number): Operand {
    return this.operands()[i] ?? null;
  }

  setField(id: string) {
    const f = this.contentTypes.fieldsById().get(id) ?? null;
    if (f?.type !== this.field()?.type) {
      // Operators and operand types depend on the field type — reset them.
      this.funcName.set(OPTIONS_BY_TYPE[f?.type ?? FieldsType.String]?.[0]?.value ?? null);
      this.operands.set([]);
    }
    this.field.set(f);
    this.emit();
  }

  setFunc(f: NotificationsFunctionsOptions) {
    this.funcName.set(f);
    if (!isBetween(f)) this.operands.update((o) => o.slice(0, 1));
    this.emit();
  }

  setOperand(i: number, v: Operand) {
    this.operands.update((o) => {
      const next = o.slice();
      next[i] = v === '' ? null : v;
      return next;
    });
    this.emit();
  }

  setAll(values: string[]) {
    this.operands.set(values);
    this.emit();
  }

  private value(): INotificationSettingsCondition | null {
    const field = this.field();
    const funcName = this.funcName();
    if (!field || !funcName) return null;
    const ser = (v: Operand) => (v instanceof Date ? v.toISOString() : v);
    const ops = this.operands();
    const content = this.between() ? [ser(ops[0] ?? null), ser(ops[1] ?? null)] : field.type === FieldsType.Array ? ops.map(ser) : [ser(ops[0] ?? null)];
    return { field, funcName, content: content as (string | number | null)[] };
  }

  private emit() {
    this.onTouched();
    this.onChange(this.value());
    this.onValidatorChange();
  }

  // ---- ControlValueAccessor ----
  writeValue(v: INotificationSettingsCondition | null): void {
    this.field.set(v?.field ?? null);
    this.funcName.set(v?.funcName ?? null);
    const isDate = v?.field.type === FieldsType.Date;
    this.operands.set((v?.content ?? []).map((c) => (isDate && typeof c === 'string' ? new Date(c) : c)));
  }
  registerOnChange(fn: (v: INotificationSettingsCondition | null) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
  }

  // ---- Validator ----
  validate(_: AbstractControl): ValidationErrors | null {
    const v = this.value();
    if (!v) return { incomplete: true };
    // Between needs at least one bound (the other may be open); everything else needs a value.
    return v.content.some((c) => c !== null && c !== '') ? null : { incomplete: true };
  }
  registerOnValidatorChange(fn: () => void): void {
    this.onValidatorChange = fn;
  }
}
