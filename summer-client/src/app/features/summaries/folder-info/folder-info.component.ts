import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { catchError, of, switchMap } from 'rxjs';
import { UserService } from '../../../core/auth/user.service';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { IFolder, IFolderRef, ISummary, UserRef } from '../../../shared/models';
import { FolderService, hierarchyParams } from '../../../shared/services/folder.service';

const VISIBLE_MANAGERS = 3;

/**
 * Hover popup for a summary's folder chip: the folder's path in the tree (each level opens it in the hierarchy), how
 * many summaries it holds, its managers, and a link to the summary inside it. Rendered only while the popup is open.
 */
@Component({
  selector: 'app-folder-info',
  imports: [RouterLink, NzIconModule, AvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './folder-info.component.html',
  styleUrl: './folder-info.component.scss',
})
export class FolderInfoComponent {
  private readonly folders = inject(FolderService);
  private readonly users = inject(UserService);

  readonly summary = input.required<Pick<ISummary, '_id' | 'kind' | 'folder'>>();

  readonly hierarchyParams = hierarchyParams;
  /** null while loading; on failure the popup falls back to the folder's name alone. */
  private readonly tree = toSignal<IFolder[] | null>(this.folders.cachedTree().pipe(catchError(() => of([]))), { initialValue: null });

  readonly folder = computed(() => {
    const id = this.summary().folder?._id;
    return this.tree()?.find((f) => f._id === id) ?? null;
  });
  /** Root first, ending with the summary's folder; just the folder when the tree hasn't loaded or lacks it. */
  readonly path = computed<IFolderRef[]>(() => {
    const own = this.summary().folder;
    const tree = this.tree();
    const start = this.folder();
    if (!own) return [];
    if (!tree || !start) return [own];
    const byId = new Map(tree.map((f) => [f._id, f]));
    const chain: IFolderRef[] = [];
    for (let cur: IFolder | undefined = start; cur && chain.length < 50; cur = cur.parentId ? byId.get(cur.parentId) : undefined) chain.unshift({ _id: cur._id, name: cur.name });
    return chain;
  });

  readonly managers = toSignal(
    toObservable(this.folder).pipe(switchMap((f) => (f?.managers.length ? this.users.byIds(f.managers).pipe(catchError(() => of([] as UserRef[]))) : of([] as UserRef[])))),
    { initialValue: [] as UserRef[] },
  );
  readonly visibleManagers = computed(() => this.managers().slice(0, VISIBLE_MANAGERS));
  readonly moreManagers = computed(() => Math.max(0, this.managers().length - VISIBLE_MANAGERS));
  readonly loading = computed(() => this.tree() === null);
}
