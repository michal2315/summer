import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { FormArray, FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { HasPendingChanges } from '../../core/auth/guards';
import { INotificationSettings, INotificationSettingsCondition } from '../../shared/models';
import { CreateNotificationConditionComponent } from './create-notification-condition.component';
import { NotificationsSettingsService, describeRule } from './notification-rules';

/** /notifications/create and /notifications/:id/edit — rule name, delivery channels, condition rows. */
@Component({
  selector: 'app-create-notification',
  imports: [ReactiveFormsModule, RouterLink, NzButtonModule, NzCheckboxModule, NzFormModule, NzIconModule, NzInputModule, CreateNotificationConditionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="page" nz-form nzLayout="vertical" [formGroup]="form" (ngSubmit)="save()">
      <header class="header">
        <a routerLink="/notifications" class="back"><span nz-icon nzType="arrow-right"></span> ניהול התראות</a>
        <h1 class="page-title">{{ id() ? 'עריכת כלל התראה' : 'התראה חדשה' }}</h1>
      </header>

      <nz-form-item>
        <nz-form-label nzRequired nzFor="rule-name">שם הכלל</nz-form-label>
        <nz-form-control nzErrorTip="חובה למלא שם">
          <input nz-input id="rule-name" formControlName="name" placeholder="לדוגמה: הרצאות חדשות במבני נתונים" />
        </nz-form-control>
      </nz-form-item>

      <div class="channels" role="group" aria-label="ערוצי התראה">
        <label nz-checkbox formControlName="isNotify"><span nz-icon nzType="bell"></span> התראה במערכת</label>
        <label nz-checkbox formControlName="isMail"><span nz-icon nzType="mail"></span> שליחת מייל</label>
        @if (submitted() && form.hasError('noChannel')) {
          <span class="error">יש לבחור לפחות ערוץ אחד</span>
        }
      </div>

      <h2>תנאים <span class="muted">(כולם צריכים להתקיים)</span></h2>
      <div class="conditions" formArrayName="conditions">
        @for (c of form.controls.conditions.controls; track c; let i = $index) {
          <div class="condition" [class.invalid]="submitted() && c.invalid">
            <span class="and">{{ i === 0 ? 'כאשר' : 'וגם' }}</span>
            <app-create-notification-condition [formControlName]="i" />
            <button nz-button nzType="text" type="button" (click)="removeCondition(i)" [disabled]="form.controls.conditions.length === 1" aria-label="הסרת תנאי">
              <span nz-icon nzType="minus-circle"></span>
            </button>
          </div>
        }
      </div>
      <button nz-button nzType="dashed" type="button" (click)="addCondition()" class="add"><span nz-icon nzType="plus"></span> הוספת תנאי</button>

      @if (preview(); as p) {
        <p class="preview"><span nz-icon nzType="info-circle"></span> {{ p }}</p>
      }

      <footer class="actions">
        <a nz-button routerLink="/notifications">ביטול</a>
        <button nz-button nzType="primary" type="submit" [nzLoading]="saving()">שמירה</button>
      </footer>
    </form>
  `,
  styles: `
    :host { display: block; padding: 14px 18px; background: #fff; min-height: 100%; }
    .page { max-width: 900px; margin: 0 auto; display: flex; flex-direction: column; gap: 8px; }
    .header { display: flex; flex-direction: column; gap: 2px; margin-bottom: 8px; }
    .back { font-size: 13px; color: #666; }
    h2 { font-size: 14px; font-weight: 800; margin: 8px 0 0; }
    .channels { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
    .error { color: #e74d3d; font-size: 13px; }
    .conditions { display: flex; flex-direction: column; gap: 8px; }
    .condition { display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 8px; background: #fafafa; }
    .condition.invalid { outline: 1px solid #e74d3d; }
    .and { width: 44px; font-weight: 700; font-size: 13px; color: #666; }
    .add { align-self: flex-start; }
    .preview { background: #f0f5ff; border-radius: 8px; padding: 8px 12px; margin: 4px 0 0; font-size: 13px; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid #f0f0f0; padding-top: 12px; margin-top: 8px; }
  `,
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
