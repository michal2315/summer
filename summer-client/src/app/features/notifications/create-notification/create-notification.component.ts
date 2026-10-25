import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { FormArray, FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { HasPendingChanges } from '../../../core/auth/guards';
import { INotificationSettings, INotificationSettingsCondition } from '../../../shared/models';
import { CreateNotificationConditionComponent } from '../create-notification-condition/create-notification-condition.component';
import { NotificationsSettingsService, describeRule } from '../notification-rules';

/** /notifications/create and /notifications/:id/edit — rule name, delivery channels, condition rows. */
@Component({
  selector: 'app-create-notification',
  imports: [ReactiveFormsModule, RouterLink, NzButtonModule, NzCheckboxModule, NzFormModule, NzIconModule, NzInputModule, CreateNotificationConditionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './create-notification.component.html',
  styleUrl: './create-notification.component.scss',
})
export class CreateNotificationComponent implements HasPendingChanges {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly service = inject(NotificationsSettingsService);
  private readonly router = inject(Router);
  private readonly message = inject(NzMessageService);

  /** Route param on the edit route. */
  readonly id = input<string | undefined>(undefined);

  readonly form = this.fb.group(
    {
      name: ['', [Validators.required, Validators.maxLength(120)]],
      isNotify: true,
      isMail: false,
      conditions: new FormArray<FormControl<INotificationSettingsCondition | null>>([this.conditionControl()]),
    },
    { validators: (g) => (g.value.isNotify || g.value.isMail ? null : { noChannel: true }) },
  );

  readonly submitted = signal(false);
  readonly saving = signal(false);
  readonly preview = signal('');
  private saved = false;
  private creationDate?: string;

  constructor() {
    this.form.controls.conditions.valueChanges.subscribe((list) => {
      const done = list.filter((c): c is INotificationSettingsCondition => !!c);
      this.preview.set(done.length ? `תתקבל התראה כאשר ${describeRule({ conditions: done })}` : '');
    });
    effect(() => {
      const id = this.id();
      if (id) untracked(() => this.loadRule(id));
    });
  }

  private conditionControl(v: INotificationSettingsCondition | null = null) {
    return new FormControl<INotificationSettingsCondition | null>(v);
  }

  private loadRule(id: string) {
    this.service.findById(id).subscribe((rule) => {
      if (!rule) {
        this.router.navigate(['/notifications']);
        return;
      }
      this.creationDate = rule.creationDate;
      const conditions = this.form.controls.conditions;
      conditions.clear();
      for (const c of rule.conditions) conditions.push(this.conditionControl(c));
      this.form.patchValue({ name: rule.name, isNotify: rule.isNotify, isMail: rule.isMail });
      this.form.markAsPristine();
    });
  }

  addCondition() {
    this.form.controls.conditions.push(this.conditionControl());
    this.form.markAsDirty();
  }

  removeCondition(i: number) {
    this.form.controls.conditions.removeAt(i);
    this.form.markAsDirty();
  }

  canLeave(): boolean {
    return this.saved || this.form.pristine;
  }

  save() {
    this.submitted.set(true);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.form.controls.name.markAsDirty();
      return;
    }
    const v = this.form.getRawValue();
    const rule: INotificationSettings = {
      ...(this.id() ? { _id: this.id(), creationDate: this.creationDate } : {}),
      name: v.name.trim(),
      isNotify: v.isNotify,
      isMail: v.isMail,
      conditions: v.conditions.filter((c): c is INotificationSettingsCondition => !!c),
    };
    this.saving.set(true);
    this.service.save(rule).subscribe({
      next: () => {
        this.saved = true;
        this.message.success('הכלל נשמר');
        this.router.navigate(['/notifications']);
      },
      error: () => this.saving.set(false),
    });
  }
}
