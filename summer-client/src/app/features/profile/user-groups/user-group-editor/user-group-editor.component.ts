import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { Subject, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { UserService } from '../../../../core/auth/user.service';
import { AvatarComponent } from '../../../../shared/components/avatar/avatar.component';
import { IUserGroup, UserRef } from '../../../../shared/models';
import { PermissionService } from '../../../../shared/services/permission.service';
import { UserGroupService } from '../../../../shared/services/user-group.service';

export interface UserGroupEditorData {
  /** The group to edit; absent for a new one. */
  group?: IUserGroup;
  /** A new group's members (e.g. what a tag field holds). */
  users?: UserRef[];
  permissions?: string[];
}

const mergeById = <T extends { _id: string }>(a: T[], b: T[]): T[] => {
  const seen = new Set<string>();
  return [...a, ...b].filter((x) => !seen.has(x._id) && seen.add(x._id));
};

/**
 * Create or edit a user group: its name, its members (users and permission groups, picked in one field the way the
 * summary form tags them) and whether others can find and use it. Closes with the saved group.
 */
@Component({
  selector: 'app-user-group-editor',
  imports: [FormsModule, NzButtonModule, NzCheckboxModule, NzIconModule, NzInputModule, NzSelectModule, AvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './user-group-editor.component.html',
  styleUrl: './user-group-editor.component.scss',
})
export class UserGroupEditorComponent {
  private readonly data = inject<UserGroupEditorData>(NZ_MODAL_DATA);
  readonly modal = inject<NzModalRef<UserGroupEditorComponent, IUserGroup>>(NzModalRef);
  private readonly groups = inject(UserGroupService);
  private readonly users = inject(UserService);
  readonly permissionGroups = inject(PermissionService);
  private readonly message = inject(NzMessageService);
  private readonly destroyRef = inject(DestroyRef);

  readonly group = this.data.group;
  private readonly initialUsers = this.group?.users ?? this.data.users ?? [];

  readonly name = signal(this.group?.name ?? '');
  readonly isShared = signal(this.group?.isShared ?? false);
  /** `u:<id>` for users, `g:<id>` for permission groups. */
  readonly value = signal<string[]>([...this.initialUsers.map((u) => `u:${u._id}`), ...(this.group?.permissions ?? this.data.permissions ?? []).map((id) => `g:${id}`)]);
  readonly busy = signal(false);

  /** Users found by the last search, plus the ones already picked (so their names keep showing). */
  private readonly found = signal<UserRef[]>([]);
  private readonly known = signal<UserRef[]>(this.initialUsers);
  private readonly query = signal('');
  private readonly search$ = new Subject<string>();

  readonly userOptions = computed(() => {
    const q = this.query().trim().toLowerCase();
    const picked = new Set(this.ids('u:'));
    const matches = (u: UserRef) => !q || u.fullName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q);
    // Suggestions: pinned users and members of the user's other groups (matching what's typed, at once), then the server's matches.
    const members = (this.groups.list() ?? []).filter((g) => g._id !== this.group?._id).flatMap((g) => g.users);
    const suggested = mergeById(this.users.user()?.pinnedUsers ?? [], members).filter(matches);
    return mergeById(
      mergeById(q ? suggested : suggested.slice(0, 15), q ? this.found() : []),
      this.known().filter((u) => picked.has(u._id)),
    );
  });
  readonly groupOptions = computed(() => {
    const q = this.query().trim().toLowerCase();
    const picked = new Set(this.ids('g:'));
    return this.permissionGroups.list().filter((p) => picked.has(p._id) || !q || p.name.toLowerCase().includes(q));
  });

  readonly empty = computed(() => !this.value().length);
  /** Another group of the user's with this name (the server refuses it). */
  readonly nameTaken = computed(() => {
    const n = this.name().trim().toLowerCase();
    return !!n && (this.groups.list() ?? []).some((g) => g._id !== this.group?._id && g.name.trim().toLowerCase() === n);
  });

  constructor() {
    this.groups.ensureLoaded();
    this.search$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((t) => (t.trim() ? this.users.byName(t.trim()) : of([]))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((list) => {
        this.found.set(list);
        this.known.update((k) => mergeById(k, list));
      });
  }

  onSearch(text: string) {
    if (text.trim() !== this.query().trim()) this.found.set([]);
    this.query.set(text);
    this.search$.next(text);
  }

  onChange(values: string[]) {
    // Pinned users picked from the list become known too.
    this.known.update((k) => mergeById(k, this.users.user()?.pinnedUsers ?? []));
    this.value.set(values);
  }

  permissionColor(id: string) {
    return this.permissionGroups.byId().get(id)?.color ?? '#ccc';
  }

  save() {
    const name = this.name().trim();
    if (!name || this.empty() || this.nameTaken() || this.busy()) return;
    const body = { name, users: this.ids('u:'), permissions: this.ids('g:'), isShared: this.isShared() };
    const req = this.group ? this.groups.update(this.group._id, body) : this.groups.create({ ...body, isFavorite: false });
    this.busy.set(true);
    req.subscribe({
      next: (g) => {
        this.message.success(this.group ? 'קבוצת המשתמשים נשמרה' : `קבוצת המשתמשים "${g.name}" נוצרה`);
        this.modal.close(g);
      },
      error: () => this.busy.set(false),
    });
  }

  private ids(prefix: string): string[] {
    return this.value()
      .filter((v) => v.startsWith(prefix))
      .map((v) => v.slice(prefix.length));
  }
}
