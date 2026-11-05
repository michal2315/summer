import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzColorPickerModule } from 'ng-zorro-antd/color-picker';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { catchError, of } from 'rxjs';
import { NotificationBellComponent } from '../../../shared/components/notification-bell/notification-bell.component';
import { InViewDirective } from '../../../shared/components/in-view.directive';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { IPermission } from '../../../shared/models';
import { PermissionService } from '../../../shared/services/permission.service';
import { renderPages } from '../../../shared/utils/render-pages';

interface Draft {
  name: string;
  groupName: string;
  color: string;
}

const NEW_ID = '__new__';

/** /permissions — permission groups admin (spec §10.14). Inline pencil→tick editing; create/delete for permitted users. */
@Component({
  selector: 'app-permissions-page',
  imports: [
    FormsModule,
    NzButtonModule,
    NzColorPickerModule,
    NzEmptyModule,
    NzIconModule,
    NzInputModule,
    NzPopconfirmModule,
    NzToolTipModule,
    InViewDirective,
    NotificationBellComponent,
    SkeletonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './permissions-page.component.html',
  styleUrl: './permissions-page.component.scss',
})
export class PermissionsPageComponent {
  readonly permissionGroups = inject(PermissionService);
  private readonly message = inject(NzMessageService);

  readonly isPermitted = toSignal(this.permissionGroups.canManage().pipe(catchError(() => of(false))), { initialValue: false });

  /** Row being edited (permission id, or NEW_ID for the unsaved new row) and its draft values. */
  readonly editingId = signal<string | null>(null);
  readonly draft = signal<Draft>({ name: '', groupName: '', color: '#0000c9' });
  readonly saving = signal(false);
  readonly NEW_ID = NEW_ID;

  readonly rows = computed<IPermission[]>(() => {
    const list = this.permissionGroups.list();
    return this.editingId() === NEW_ID ? [{ _id: NEW_ID, name: '', groupName: '', color: this.draft().color }, ...list] : list;
  });
  readonly page = renderPages(this.rows, 30);

  startNew() {
    this.draft.set({ name: '', groupName: '', color: '#0000c9' });
    this.editingId.set(NEW_ID);
  }

  edit(p: IPermission) {
    this.draft.set({ name: p.name, groupName: p.groupName ?? '', color: p.color });
    this.editingId.set(p._id);
  }

  patch(change: Partial<Draft>) {
    this.draft.update((d) => ({ ...d, ...change }));
  }

  cancel() {
    this.editingId.set(null);
  }

  save() {
    const id = this.editingId();
    const d = this.draft();
    if (!d.name.trim()) {
      this.message.warning('חובה למלא שם הרשאה');
      return;
    }
    this.saving.set(true);
    this.permissionGroups.save({ ...(id && id !== NEW_ID ? { _id: id } : {}), name: d.name.trim(), groupName: d.groupName.trim(), color: d.color }).subscribe({
      next: () => {
        this.message.success(id === NEW_ID ? 'ההרשאה נוצרה' : 'ההרשאה עודכנה');
        this.editingId.set(null);
        this.saving.set(false);
      },
      error: () => this.saving.set(false),
    });
  }

  remove(p: IPermission) {
    this.permissionGroups.delete(p._id).subscribe(() => this.message.success('ההרשאה נמחקה'));
  }
}
