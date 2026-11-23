import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzSwitchModule } from 'ng-zorro-antd/switch';
import { Subject, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { UserService } from '../../../core/auth/user.service';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { IPouchFormat, IPouchMember, PouchRole, UserRef } from '../../../shared/models';
import { PouchService } from '../../../shared/services/pouch.service';

export interface PouchShareData {
  format: IPouchFormat;
}

export const ROLE_OPTIONS: { value: PouchRole; label: string; hint: string }[] = [
  { value: 'viewer', label: 'שימוש', hint: 'יכול לייצא עם הפורמט ולהעתיק אותו לעצמו' },
  { value: 'editor', label: 'עריכה', hint: 'יכול גם לשנות את הפורמט' },
];

/**
 * Who gets a format (the owner's call). Two different things: sharing with chosen people — each either to use it
 * (export with it, copy it) or also to edit it — and sharing with everyone (anyone can find, use and copy it).
 * Closes with the updated format.
 */
@Component({
  selector: 'app-pouch-share',
  imports: [FormsModule, NzButtonModule, NzIconModule, NzSelectModule, NzSwitchModule, AvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pouch-share.component.html',
  styleUrl: './pouch-share.component.scss',
})
export class PouchShareComponent {
  private readonly data = inject<PouchShareData>(NZ_MODAL_DATA);
  private readonly ref = inject(NzModalRef<PouchShareComponent, IPouchFormat>);
  private readonly pouch = inject(PouchService);
  private readonly users = inject(UserService);
  private readonly message = inject(NzMessageService);

  readonly roles = ROLE_OPTIONS;
  readonly isShared = signal(this.data.format.isShared);
  readonly members = signal<IPouchMember[]>(this.data.format.members);
  readonly saving = signal(false);

  /** The "add a person" box: search results (and pinned users), leaving out the owner and people already in. */
  private readonly found = signal<UserRef[]>([]);
  readonly options = computed(() => {
    const taken = new Set(this.members().map((m) => m.user._id));
    const all = [...new Map([...this.found(), ...(this.users.user()?.pinnedUsers ?? [])].map((u) => [u._id, u])).values()];
    return all.filter((u) => u._id !== this.users.userId() && !u.isSystem && !taken.has(u._id));
  });
  readonly adding = signal<string | null>(null);
  private readonly search$ = new Subject<string>();

  readonly editors = computed(() => this.members().filter((m) => m.role === 'editor').length);

  constructor() {
    this.search$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((t) => (t.trim() ? this.users.byName(t.trim()) : of([]))),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((list) => this.found.set(list));
  }

  onSearch(text: string) {
    this.search$.next(text);
  }

  /** A person picked in the search box joins the list as a viewer; their role can be raised in the row. */
  add(id: string | null) {
    const user = this.options().find((u) => u._id === id);
    if (user) this.members.update((list) => [...list, { user, role: 'viewer' }]);
    // Clear the box for the next one.
    this.adding.set(id);
    queueMicrotask(() => this.adding.set(null));
  }

  setRole(id: string, role: PouchRole) {
    this.members.update((list) => list.map((m) => (m.user._id === id ? { ...m, role } : m)));
  }

  remove(id: string) {
    this.members.update((list) => list.filter((m) => m.user._id !== id));
  }

  save() {
    this.saving.set(true);
    const members = this.members().map((m) => ({ user: m.user._id, role: m.role }));
    this.pouch.update(this.data.format._id, { isShared: this.isShared(), members }).subscribe({
      next: (f) => {
        this.message.success('השיתוף עודכן');
        this.ref.close(f);
      },
      error: () => this.saving.set(false),
    });
  }

  cancel() {
    this.ref.close();
  }
}
