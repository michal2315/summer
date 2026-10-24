import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { Subject, debounceTime, distinctUntilChanged, filter, switchMap } from 'rxjs';
import { UserService } from '../../core/auth/user.service';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { IFolder, UserRef } from '../../shared/models';
import { CatalogService } from '../../shared/services/catalog.service';
import { FolderService } from '../../shared/services/folder.service';

export interface FolderEditorData {
  /** edit this folder */
  folder?: IFolder;
  /** create a new folder under this parent (null = root) */
  parentId?: string | null;
}

/** Create / edit a folder: name, permission groups, managers. */
@Component({
  selector: 'app-folder-editor-modal',
  imports: [ReactiveFormsModule, NzButtonModule, NzFormModule, NzInputModule, NzSelectModule, AvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form nz-form nzLayout="vertical" [formGroup]="form" (ngSubmit)="save()">
      <nz-form-item>
        <nz-form-label nzRequired nzFor="f-name">שם התיקייה</nz-form-label>
        <nz-form-control nzErrorTip="חובה למלא שם">
          <input nz-input id="f-name" formControlName="name" placeholder="לדוגמה: שנה א׳" />
        </nz-form-control>
      </nz-form-item>
      <nz-form-item>
        <nz-form-label>הרשאות</nz-form-label>
        <nz-form-control nzExtra="ללא הרשאות — התיקייה גלויה לכל מי שרואה את תיקיית האב">
          <nz-select formControlName="permissions" nzMode="multiple" nzPlaceHolder="מי יכול לראות את התיקייה" nzShowSearch>
            @for (p of catalog.permissions(); track p._id) {
              <nz-option nzCustomContent [nzValue]="p._id" [nzLabel]="p.name"><i class="dot" [style.background]="p.color"></i> {{ p.name }}</nz-option>
            }
          </nz-select>
        </nz-form-control>
      </nz-form-item>
      <nz-form-item>
        <nz-form-label>מנהלים</nz-form-label>
        <nz-form-control>
          <nz-select formControlName="managers" nzMode="multiple" nzShowSearch nzServerSearch nzPlaceHolder="חיפוש לפי שם" (nzOnSearch)="userQuery$.next($event)">
            @for (u of userOptions(); track u._id) {
              <nz-option nzCustomContent [nzValue]="u._id" [nzLabel]="u.fullName"><app-avatar [user]="u" [size]="20" /> {{ u.fullName }}</nz-option>
            }
          </nz-select>
        </nz-form-control>
      </nz-form-item>
      <footer>
        <button nz-button type="button" (click)="modal.close()">ביטול</button>
        <button nz-button nzType="primary" type="submit" [nzLoading]="busy()">{{ f ? 'שמירה' : 'יצירה' }}</button>
      </footer>
    </form>
  `,
  styles: `
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-inline-end: 4px; }
    footer { display: flex; justify-content: flex-end; gap: 8px; }
  `,
})
export class FolderEditorModalComponent {
  readonly data = inject<FolderEditorData>(NZ_MODAL_DATA, { optional: true });
  readonly modal = inject<NzModalRef<FolderEditorModalComponent, IFolder>>(NzModalRef);
  readonly catalog = inject(CatalogService);
  private readonly users = inject(UserService);
  private readonly folders = inject(FolderService);
  private readonly message = inject(NzMessageService);

  readonly f = this.data?.folder;
  readonly form = inject(FormBuilder).nonNullable.group({
    name: [this.f?.name ?? '', [Validators.required, Validators.maxLength(120)]],
    permissions: [this.f?.permissions.map((p) => p._id) ?? ([] as string[])],
    // New folders are managed by their creator by default.
    managers: [this.f?.managers ?? [this.users.userId()!]],
  });
  readonly userOptions = signal<UserRef[]>([]);
  readonly busy = signal(false);
  readonly userQuery$ = new Subject<string>();

  constructor() {
    const ids = this.form.controls.managers.value;
    if (ids.length) this.users.byIds(ids).subscribe((list) => this.userOptions.set(list));
    this.userQuery$
      .pipe(
        filter((t) => t.trim().length > 1),
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((t) => this.users.byName(t.trim())),
      )
      .subscribe((list) => {
        const keep = this.userOptions().filter((u) => this.form.controls.managers.value.includes(u._id));
        this.userOptions.set([...keep, ...list.filter((u) => !keep.some((k) => k._id === u._id))]);
      });
  }

  save() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.form.controls.name.markAsDirty();
      return;
    }
    const v = this.form.getRawValue();
    const payload = { name: v.name.trim(), permissions: v.permissions, managers: v.managers };
    this.busy.set(true);
    const req = this.f ? this.folders.edit(this.f._id, payload) : this.folders.create({ ...payload, parentId: this.data?.parentId ?? null });
    req.subscribe({
      next: (saved) => {
        this.message.success(this.f ? 'התיקייה עודכנה' : 'התיקייה נוצרה');
        this.modal.close(saved);
      },
      error: () => this.busy.set(false),
    });
  }
}
