import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { Subject, debounceTime, distinctUntilChanged, filter, switchMap } from 'rxjs';
import { UserService } from '../../../core/auth/user.service';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { ICollection, UserRef } from '../../../shared/models';
import { PermissionService } from '../../../shared/services/permission.service';
import { CollectionService } from '../../../shared/services/collection.service';

export interface CollectionEditorData {
  collection?: ICollection;
}

/** Create / edit a collection: name, permission groups, managers. */
@Component({
  selector: 'app-collection-editor-modal',
  imports: [ReactiveFormsModule, NzButtonModule, NzFormModule, NzInputModule, NzSelectModule, AvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './collection-editor-modal.component.html',
  styleUrl: './collection-editor-modal.component.scss',
})
export class CollectionEditorModalComponent {
  readonly data = inject<CollectionEditorData>(NZ_MODAL_DATA, { optional: true });
  readonly modal = inject<NzModalRef<CollectionEditorModalComponent, ICollection>>(NzModalRef);
  readonly permissionGroups = inject(PermissionService);
  private readonly users = inject(UserService);
  private readonly collections = inject(CollectionService);
  private readonly message = inject(NzMessageService);

  private readonly c = this.data?.collection;
  readonly form = inject(FormBuilder).nonNullable.group({
    name: [this.c?.name ?? '', [Validators.required, Validators.maxLength(120)]],
    // The server requires at least one permission group per collection.
    permissions: [this.c?.permissions.map((p) => p._id) ?? ([] as string[]), Validators.required],
    // New collections are managed by their creator by default.
    managers: [this.c?.managers ?? [this.users.userId()!]],
  });
  readonly userOptions = signal<UserRef[]>([]);
  readonly busy = signal(false);
  readonly userQuery$ = new Subject<string>();

  constructor() {
    const ids = this.form.controls.managers.value;
    if (ids.length) this.users.byIds(ids).subscribe((list) => this.userOptions.set(list));
    this.userQuery$
      .pipe(
        filter((t) => t.trim().length > 0),
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
      this.form.controls.permissions.markAsDirty();
      return;
    }
    const v = this.form.getRawValue();
    const payload = { name: v.name.trim(), permissions: v.permissions, managers: v.managers };
    this.busy.set(true);
    const req = this.c ? this.collections.edit(this.c._id, { ...payload, summaries: [] }) : this.collections.create(payload);
    req.subscribe({
      next: (saved) => {
        this.message.success(this.c ? 'הלקט עודכן' : 'הלקט נוצר');
        this.modal.close(saved);
      },
      error: () => this.busy.set(false),
    });
  }
}
