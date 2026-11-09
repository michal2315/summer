import { ChangeDetectionStrategy, Component, computed, forwardRef, inject, signal } from '@angular/core';
import { AbstractControl, ControlValueAccessor, FormsModule, NG_VALIDATORS, NG_VALUE_ACCESSOR, ValidationErrors, Validator } from '@angular/forms';
import { NzDatePickerModule } from 'ng-zorro-antd/date-picker';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { Subject, debounceTime, switchMap } from 'rxjs';
import { CapsuleChipComponent } from '../../../shared/components/capsules/capsule-chip/capsule-chip.component';
import { FieldsType, ICapsule, IField, INotificationSettingsCondition, NotificationsFunctionsOptions } from '../../../shared/models';
import { CapsuleService } from '../../../shared/services/capsule.service';
import { ContentTypeService } from '../../../shared/services/content-type.service';
import { LabelService } from '../../../shared/services/label.service';
import { OPTIONS_BY_TYPE, SUMMARY_TEXT_FIELD, isBetween, isCapsuleFunc } from '../notification-rules';

type Operand = string | number | Date | null;

/**
 * One rule condition as a form control: field → operator (per field type) → value input typed by the field.
 * *Between operators take two operands; an empty bound is open-ended. Capsule operators take a capsule, stored as
 * [id, name]. Besides the catalog fields there is the summary's own text (SUMMARY_TEXT_FIELD).
 */
@Component({
  selector: 'app-create-notification-condition',
  imports: [FormsModule, NzDatePickerModule, NzInputModule, NzInputNumberModule, NzSelectModule, CapsuleChipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => CreateNotificationConditionComponent), multi: true },
    { provide: NG_VALIDATORS, useExisting: forwardRef(() => CreateNotificationConditionComponent), multi: true },
  ],
  templateUrl: './create-notification-condition.component.html',
  styleUrl: './create-notification-condition.component.scss',
})
export class CreateNotificationConditionComponent implements ControlValueAccessor, Validator {
  readonly contentTypes = inject(ContentTypeService);
  private readonly labels = inject(LabelService);
  private readonly capsules = inject(CapsuleService);
  readonly FT = FieldsType;

  readonly fieldOptions = computed(() => [SUMMARY_TEXT_FIELD, ...this.contentTypes.fields()]);

  readonly field = signal<IField | null>(null);
  readonly funcName = signal<NotificationsFunctionsOptions | null>(null);
  readonly operands = signal<Operand[]>([]);
  readonly disabled = signal(false);

  readonly options = computed(() => (this.field() ? OPTIONS_BY_TYPE[this.field()!.type] ?? [] : []));
  readonly between = computed(() => isBetween(this.funcName()));
  readonly capsuleMode = computed(() => isCapsuleFunc(this.funcName()));

  /** Capsule picker: the chosen one first (so its name shows), then the search results. */
  private readonly capsuleResults = signal<ICapsule[]>([]);
  readonly capsuleQuery$ = new Subject<string>();
  readonly capsuleOptions = computed(() => {
    const id = this.operand(0) as string | null;
    const chosen = id ? (this.capsules.byId(id) ?? { _id: id, name: String(this.operand(1) ?? id), description: '', words: [] }) : null;
    return [...(chosen ? [chosen] : []), ...this.capsuleResults().filter((c) => c._id !== id)];
  });

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

    this.capsuleQuery$
      .pipe(
        debounceTime(200),
        switchMap((q) => this.capsules.search(q)),
      )
      .subscribe((list) => this.capsuleResults.set(list));
    this.capsuleQuery$.next('');
  }

  operand(i: number): Operand {
    return this.operands()[i] ?? null;
  }

  setField(id: string) {
    const f = id === SUMMARY_TEXT_FIELD._id ? SUMMARY_TEXT_FIELD : (this.contentTypes.fieldsById().get(id) ?? null);
    if (f?.type !== this.field()?.type) {
      // Operators and operand types depend on the field type — reset them.
      this.funcName.set(OPTIONS_BY_TYPE[f?.type ?? FieldsType.String]?.[0]?.value ?? null);
      this.operands.set([]);
    }
    this.field.set(f);
    this.emit();
  }

  setFunc(f: NotificationsFunctionsOptions) {
    // A capsule operand and a typed one don't carry over to each other.
    if (isCapsuleFunc(f) !== this.capsuleMode()) this.operands.set([]);
    this.funcName.set(f);
    if (!isBetween(f) && !isCapsuleFunc(f)) this.operands.update((o) => o.slice(0, 1));
    this.emit();
  }

  setCapsule(id: string | null) {
    const c = id ? this.capsuleOptions().find((x) => x._id === id) : undefined;
    this.operands.set(c ? [c._id, c.name] : []);
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
    const content =
      this.between() || this.capsuleMode()
        ? [ser(ops[0] ?? null), ser(ops[1] ?? null)]
        : field.type === FieldsType.Array
          ? ops.map(ser)
          : [ser(ops[0] ?? null)];
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
