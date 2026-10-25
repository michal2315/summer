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
import { IFolder, UserRef } from '../../../shared/models';
import { PermissionService } from '../../../shared/services/permission.service';
import { FolderService, managedFolderPaths } from '../../../shared/services/folder.service';

export interface FolderEditorData {
  /** edit this folder */
  folder?: IFolder;
  /** create a new folder under this parent (null = root) */
  parentId?: string | null;
  /** create: every visible folder, to offer as the (optional) parent */
  folders?: IFolder[];
}

interface ParentOption {
  _id: string;
  path: string;
}

/** Create / edit a folder: name, permission groups, managers. */
@Component({
  selector: 'app-folder-editor-modal',
  imports: [ReactiveFormsModule, NzButtonModule, NzFormModule, NzInputModule, NzSelectModule, AvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './folder-editor-modal.component.html',
  styleUrl: './folder-editor-modal.component.scss',
})
export class FolderEditorModalComponent {
  readonly data = inject<FolderEditorData>(NZ_MODAL_DATA, { optional: true });
  readonly modal = inject<NzModalRef<FolderEditorModalComponent, IFolder>>(NzModalRef);
  readonly permissionGroups = inject(PermissionService);
  private readonly users = inject(UserService);
  private readonly folders = inject(FolderService);
  private readonly message = inject(NzMessageService);

  readonly f = this.data?.folder;
  readonly form = inject(FormBuilder).nonNullable.group({
    name: [this.f?.name ?? '', [Validators.required, Validators.maxLength(120)]],
    // The server requires at least one permission group per folder.
    permissions: [this.f?.permissions.map((p) => p._id) ?? ([] as string[]), Validators.required],
    // New folders are managed by their creator by default.
    managers: [this.f?.managers ?? [this.users.userId()!]],
    /** create only; null = a new root folder */
    parentId: [this.data?.parentId ?? (null as string | null)],
  });

  /** Folders the user manages (only a manager may add a subfolder), labelled with their full path. */
  readonly parentOptions: ParentOption[] = managedFolderPaths(this.data?.folders ?? [], this.users.userId() ?? '');
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
    const req = this.f ? this.folders.edit(this.f._id, payload) : this.folders.create({ ...payload, parentId: v.parentId });
    req.subscribe({
      next: (saved) => {
        this.message.success(this.f ? 'התיקייה עודכנה' : 'התיקייה נוצרה');
        this.modal.close(saved);
      },
      error: () => this.busy.set(false),
    });
  }
}
