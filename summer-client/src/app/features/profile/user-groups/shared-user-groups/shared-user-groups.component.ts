import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { Subject, debounceTime, distinctUntilChanged, startWith, switchMap } from 'rxjs';
import { IUserGroup } from '../../../../shared/models';
import { PermissionService } from '../../../../shared/services/permission.service';
import { UserGroupService } from '../../../../shared/services/user-group.service';
import { describeMembers } from '../user-group-members';

const PAGE = 30;

/** Others' shared user groups: search by name or owner, copy one to your own (private) groups. */
@Component({
  selector: 'app-shared-user-groups',
  imports: [FormsModule, NzButtonModule, NzIconModule, NzInputModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shared-user-groups.component.html',
  styleUrl: './shared-user-groups.component.scss',
})
export class SharedUserGroupsComponent {
  private readonly groups = inject(UserGroupService);
  private readonly permissions = inject(PermissionService);
  private readonly message = inject(NzMessageService);

  readonly text = signal('');
  readonly list = signal<IUserGroup[] | null>(null);
  readonly more = signal(false);
  readonly copying = signal<string | null>(null);
  /** Ids copied while the dialog is open. */
  readonly copied = signal(new Set<string>());
  private readonly text$ = new Subject<string>();

  constructor() {
    this.text$
      .pipe(
        startWith(''),
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((t) => {
          this.list.set(null);
          return this.groups.shared(t);
        }),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((list) => {
        this.list.set(list);
        this.more.set(list.length === PAGE);
      });
  }

  onText(t: string) {
    this.text.set(t);
    this.text$.next(t);
  }

  loadMore() {
    const current = this.list() ?? [];
    this.groups.shared(this.text(), current.length).subscribe((next) => {
      this.list.set([...current, ...next]);
      this.more.set(next.length === PAGE);
    });
  }

  describe(g: IUserGroup) {
    return describeMembers(g, this.permissions.byId());
  }

  copy(g: IUserGroup) {
    this.copying.set(g._id);
    this.groups.copy(g._id).subscribe({
      next: (mine) => {
        this.copying.set(null);
        this.copied.update((s) => new Set(s).add(g._id));
        this.message.success(`הקבוצה "${mine.name}" נוספה לקבוצות שלך`);
      },
      error: () => this.copying.set(null),
    });
  }
}
