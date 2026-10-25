import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/identity-provider';
import { collectionVisible } from '../collections/collection.access';
import { toApiPermission, toRef } from '../common/api-types';
import { parse, unique, zId } from '../common/validation';
import { DatabaseService } from '../database/database.service';
import { validPermissionSet } from '../permissions/permission-assignment';
import { PermissionsRepository } from '../permissions/permissions.repository';
import { SummariesRepository } from '../summaries/summaries.repository';
import { validUserSet } from '../users/user-set';
import { UsersRepository } from '../users/users.repository';
import { folderVisible } from './folder.access';
import { FoldersRepository } from './folders.repository';

export interface ApiFolder {
  _id: string;
  name: string;
  parentId: string | null;
  itemCount: number;
  permissions: ReturnType<typeof toApiPermission>[];
  managers: string[];
  createdBy: ReturnType<typeof toRef>;
  createdAt: string;
  updatedAt: string;
}

export interface ApiFolderItem {
  type: 'collection' | 'summary';
  _id: string;
  name: string;
  /** summaries only: 'summary' or 'running' (sumaroons are never placed in folders) */
  kind?: 'summary' | 'running' | 'sumaroon';
}

const payloadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  /** create only; ignored on edit (a folder's parent never changes) */
  parentId: zId.nullish(),
  permissions: z.array(zId).max(100).default([]),
  managers: z.array(zId).max(200).default([]),
});

const itemsSchema = z.object({
  items: z
    .array(z.object({ type: z.enum(['collection', 'summary']), _id: zId }))
    .min(1)
    .max(500),
});

/**
 * Hierarchy rules (decision record F1–F6): folders are viewed like collections (all-of, at least one permission,
 * plus every ancestor's); they are navigation only and do not restrict their items; managers edit, create
 * subfolders, place/remove items and delete; placing an item also needs edit rights on that item.
 */
@Injectable()
export class FoldersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly repo: FoldersRepository,
    private readonly permissions: PermissionsRepository,
    private readonly users: UsersRepository,
    private readonly summaries: SummariesRepository,
  ) {}

  /** Every folder the caller may see, flat (the client builds the tree from parentId). */
  async tree(me: CurrentUser): Promise<ApiFolder[]> {
    return this.hydrate(me, await this.repo.ids(folderVisible(me)));
  }

  async items(me: CurrentUser, id: string): Promise<ApiFolderItem[]> {
    await this.assertVisible(me, id);
    const { collections, summaries } = await this.repo.items(id, this.summaries.visible(me), collectionVisible(me));
    return [
      ...collections.map((c) => ({ type: 'collection' as const, _id: c.id, name: c.name })),
      ...summaries.map((s) => ({ type: 'summary' as const, _id: s.id, name: s.name, kind: s.kind })),
    ];
  }

  async create(me: CurrentUser, body: unknown): Promise<ApiFolder> {
    const p = parse(payloadSchema, body);
    const parentId = p.parentId ?? null;
    // Anyone may create a root folder; a subfolder needs a manager of the parent.
    if (parentId) await this.assertEditable(me, parentId);
    const permissionIds = await validPermissionSet(this.permissions, me, p.permissions, { required: true, what: 'a folder' });
    const managers = await validUserSet(this.users, [me.id, ...p.managers], 'manager');
    const id = await this.database.transaction(async () => {
      if (parentId && !(await this.repo.lockForUpdate(parentId))) throw new NotFoundException();
      const fid = await this.repo.insert({ name: p.name, parentId, createdBy: me.id });
      await this.repo.replacePermissions(fid, permissionIds);
      await this.repo.replaceEditors(fid, managers);
      return fid;
    });
    const [folder] = await this.hydrate(me, [id]);
    return folder;
  }

  async edit(me: CurrentUser, id: string, body: unknown): Promise<ApiFolder | object> {
    const p = parse(payloadSchema, body);
    await this.assertEditable(me, id);
    const permissionIds = await validPermissionSet(this.permissions, me, p.permissions, { required: true, what: 'a folder' });
    const managers = p.managers.length ? await validUserSet(this.users, p.managers, 'manager') : null;
    await this.database.transaction(async () => {
      if (!(await this.repo.lockForUpdate(id))) throw new NotFoundException();
      await this.assertEditable(me, id);
      await this.repo.update(id, { name: p.name });
      await this.repo.replacePermissions(id, permissionIds);
      if (managers) await this.repo.replaceEditors(id, managers);
    });
    // The caller may have narrowed the folder so they can no longer see it.
    const [folder] = await this.hydrate(me, [...(await this.repo.visibleIds(me, [id]))]);
    return folder ?? {};
  }

  /** Move items into the folder (out of any previous folder). Needs folder management AND edit rights on each item. */
  async addItems(me: CurrentUser, id: string, body: unknown): Promise<void> {
    const { summaryIds, collectionIds } = this.split(parse(itemsSchema, body));
    await this.assertEditable(me, id);

    const editableSummaries = await this.summaries.visibleIds(me, summaryIds, 'edit');
    const editableCollections = await this.repo.editableCollectionIds(me, collectionIds);
    if (summaryIds.some((s) => !editableSummaries.has(s)) || collectionIds.some((c) => !editableCollections.has(c)))
      throw new ForbiddenException('only an item’s editors may place it in a folder');
    for (const sid of summaryIds) {
      const row = await this.summaries.findById(sid);
      if (row?.isDraft) throw new BadRequestException('drafts cannot be placed in a folder');
      if (row?.kind === 'sumaroon') throw new BadRequestException('a sumaroon lives only inside its running summary');
    }

    await this.database.transaction(async () => {
      if (!(await this.repo.lockForUpdate(id))) throw new NotFoundException();
      await this.repo.place(id, summaryIds, collectionIds);
      await this.repo.touch(id);
    });
  }

  async removeItems(me: CurrentUser, id: string, body: unknown): Promise<void> {
    const { summaryIds, collectionIds } = this.split(parse(itemsSchema, body));
    await this.assertEditable(me, id);
    await this.database.transaction(async () => {
      await this.repo.unplace(id, summaryIds, collectionIds);
      await this.repo.touch(id);
    });
  }

  /** Deletes the folder and its subfolders; the summaries and collections inside are only taken out of the hierarchy. */
  async delete(me: CurrentUser, id: string): Promise<void> {
    await this.assertEditable(me, id);
    await this.repo.delete(id);
  }

  private split(input: z.output<typeof itemsSchema>) {
    return {
      summaryIds: unique(input.items.filter((i) => i.type === 'summary').map((i) => i._id)),
      collectionIds: unique(input.items.filter((i) => i.type === 'collection').map((i) => i._id)),
    };
  }

  private async hydrate(me: CurrentUser, ids: string[]): Promise<ApiFolder[]> {
    const [rows, counts] = await Promise.all([
      this.repo.loadFull(ids),
      this.repo.itemCounts(ids, this.summaries.visible(me), collectionVisible(me)),
    ]);
    return rows.map((f) => ({
      _id: f.id,
      name: f.name,
      parentId: f.parentId,
      itemCount: counts.get(f.id) ?? 0,
      permissions: f.permissions.map((p) => toApiPermission(p.permission)).sort((a, b) => a.name.localeCompare(b.name, 'he')),
      managers: f.editors.map((e) => e.userId),
      createdBy: toRef(f.author),
      createdAt: f.createdAt.toISOString(),
      updatedAt: f.updatedAt.toISOString(),
    }));
  }

  private async assertVisible(me: CurrentUser, id: string): Promise<void> {
    if (!(await this.repo.visibleIds(me, [id])).has(id)) throw new NotFoundException();
  }

  private async assertEditable(me: CurrentUser, id: string): Promise<void> {
    await this.assertVisible(me, id);
    if (!(await this.repo.visibleIds(me, [id], 'edit')).has(id)) throw new ForbiddenException();
  }
}
