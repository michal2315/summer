import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { NzContextMenuService, NzDropDownModule, NzDropdownMenuComponent } from 'ng-zorro-antd/dropdown';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { Observable } from 'rxjs';
import { IUserGroup } from '../../../shared/models';
import { PermissionService } from '../../../shared/services/permission.service';
import { UserGroupService } from '../../../shared/services/user-group.service';
import { SharedUserGroupsComponent } from './shared-user-groups/shared-user-groups.component';
import { UserGroupEditorComponent, UserGroupEditorData } from './user-group-editor/user-group-editor.component';
import { describeMembers } from './user-group-members';

/**
 * The user's user groups as cards on the profile shelf. A card opens the group's editor; its right-click menu favourites,
 * shares, edits or deletes it. `create` and `browseShared` are the shelf's buttons.
 */
@Component({
  selector: 'app-user-groups',
  imports: [NzDropDownModule, NzIconModule, NzToolTipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './user-groups.component.html',
  styleUrl: './user-groups.component.scss',
})
export class UserGroupsComponent {
  readonly groups = inject(UserGroupService);
  private readonly permissions = inject(PermissionService);
  private readonly message = inject(NzMessageService);
  private readonly modal = inject(NzModalService);
  private readonly contextMenu = inject(NzContextMenuService);

  /** Narrows the cards by name (the shelf's filter box). */
  readonly filter = input('');
  readonly list = computed(() => this.groups.search(this.filter()));

  /** Ids with a request in flight. */
  readonly busy = signal(new Set<string>());

  constructor() {
    this.groups.ensureLoaded();
  }

  /** Right-click (or the keyboard menu key) on a card opens its actions. */
  openMenu(event: MouseEvent, menu: NzDropdownMenuComponent) {
    event.preventDefault();
    this.contextMenu.create(event, menu);
  }

  describe(g: IUserGroup) {
    return describeMembers(g, this.permissions.byId());
  }

  create() {
    this.openEditor({}, 'קבוצת משתמשים חדשה');
  }

  edit(g: IUserGroup) {
    this.openEditor({ group: g }, 'עריכת קבוצת משתמשים');
  }

  browseShared() {
    this.modal.create({ nzTitle: 'קבוצות משתמשים משותפות', nzContent: SharedUserGroupsComponent, nzFooter: null, nzWidth: 560 });
  }

  toggleFavorite(g: IUserGroup) {
    if (this.isBusy(g)) return;
    this.track(g, this.groups.update(g._id, { isFavorite: !g.isFavorite }), () => {});
  }

  toggleShared(g: IUserGroup) {
    if (this.isBusy(g)) return;
    this.track(g, this.groups.update(g._id, { isShared: !g.isShared }), () =>
      this.message.success(g.isShared ? 'הקבוצה חזרה להיות פרטית' : 'הקבוצה משותפת: כולם יכולים למצוא אותה ולהשתמש בה'),
    );
  }

  remove(g: IUserGroup) {
    this.modal.confirm({
      nzTitle: `למחוק את קבוצת המשתמשים "${g.name}"?`,
      nzContent: 'תמציות שכבר תויגו בה לא ישתנו.',
      nzOkText: 'מחיקה',
      nzOkDanger: true,
      nzCancelText: 'ביטול',
      nzOnOk: () => this.track(g, this.groups.remove(g._id), () => this.message.success('קבוצת המשתמשים נמחקה')),
    });
  }

  isBusy(g: IUserGroup) {
    return this.busy().has(g._id);
  }

  private openEditor(data: UserGroupEditorData, title: string) {
    this.modal.create<UserGroupEditorComponent, UserGroupEditorData, IUserGroup>({
      nzTitle: title,
      nzContent: UserGroupEditorComponent,
      nzData: data,
      nzFooter: null,
      nzWidth: 560,
    });
  }

  private track(g: IUserGroup, req: Observable<unknown>, next: () => void) {
    const set = (on: boolean) =>
      this.busy.update((b) => {
        const copy = new Set(b);
        if (on) copy.add(g._id);
        else copy.delete(g._id);
        return copy;
      });
    set(true);
    req.subscribe({ next, error: () => set(false), complete: () => set(false) });
  }
}
