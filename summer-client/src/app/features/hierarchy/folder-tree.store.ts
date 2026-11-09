import { Injectable, computed, inject, signal } from '@angular/core';
import { merge } from 'rxjs';
import { UserService } from '../../core/auth/user.service';
import { IFolder, IFolderItem, SummaryKind } from '../../shared/models';
import { FolderService } from '../../shared/services/folder.service';
import { SummaryService } from '../../shared/services/summary.service';

const byName = (a: IFolder, b: IFolder) => a.name.localeCompare(b.name, 'he');

/** `folderId` value of the "no folder" view; no `folderId` at all is the root (every summary). */
export const NO_FOLDER = 'none';

/** The tree lists regular and running summaries (a sumaroon lives inside its running summary). */
const KINDS = [SummaryKind.Summary, SummaryKind.Running];

/**
 * The folder tree's data, shared by the tree in the side nav and the home page (folder names, running summary names).
 * Reloads itself whenever folders or summaries change, since the side nav stays mounted.
 */
@Injectable({ providedIn: 'root' })
export class FolderTreeStore {
  private readonly service = inject(FolderService);
  private readonly users = inject(UserService);
  private readonly summaries = inject(SummaryService);

  readonly folders = signal<IFolder[]>([]);
  readonly treeLoaded = signal(false);
  /** Items of each folder opened so far, loaded on first expand. */
  readonly items = signal(new Map<string, IFolderItem[]>());
  /** How many summaries are in no folder (null until loaded); the tree doesn't list them. */
  readonly unfiledCount = signal<number | null>(null);

  readonly byId = computed(() => new Map(this.folders().map((f) => [f._id, f])));
  /** parentId (null = root) → child folders, sorted by name. */
  readonly children = computed(() => {
    const map = new Map<string | null, IFolder[]>();
    for (const f of this.folders()) map.set(f.parentId, [...(map.get(f.parentId) ?? []), f]);
    for (const list of map.values()) list.sort(byName);
    return map;
  });
  /** Folder id → summaries you can see in it and all its subfolders (what selecting the folder lists; counted on the server). */
  readonly totals = computed(() => new Map(this.folders().map((f) => [f._id, f.subtreeCount])));

  /** The folder's ancestors, top-level first (not including the folder itself). */
  ancestors(id: string | null): IFolder[] {
    const path: IFolder[] = [];
    const byId = this.byId();
    for (let f = id ? byId.get(byId.get(id)?.parentId ?? '') : undefined; f; f = f.parentId ? byId.get(f.parentId) : undefined) path.unshift(f);
    return path;
  }

  constructor() {
    this.loadTree();
    this.loadUnfiled();
    merge(this.service.changed$, this.summaries.changed$, this.summaries.removed$).subscribe(() => this.refresh());
  }

  /** Name of a summary listed in the tree (in a loaded folder). */
  itemName(id: string | null): string | undefined {
    return [...this.items().values()].flat().find((i) => i._id === id)?.name;
  }

  loadItems(folderId: string) {
    this.service.items(folderId).subscribe((list) => this.items.update((m) => new Map(m).set(folderId, list)));
  }

  private loadTree() {
    this.service.tree().subscribe({
      next: (list) => {
        this.folders.set(list);
        this.treeLoaded.set(true);
      },
      error: () => this.treeLoaded.set(true),
    });
  }

  /** Just the count of unfiled summaries (one row is enough for it). */
  private loadUnfiled() {
    this.summaries
      .search(this.users.userId() ?? '', { noFolder: true, kinds: KINDS, limit: 1 })
      .subscribe((res) => this.unfiledCount.set(res.lengths.summary));
  }

  /** After a mutation: reload the tree and the items of every loaded folder. */
  private refresh() {
    this.loadTree();
    this.loadUnfiled();
    for (const id of this.items().keys()) this.loadItems(id);
  }
}
