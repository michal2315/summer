import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/identity-provider';
import { ApiBulkResult, toApiPermission, toRef } from '../common/api-types';
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
  /** Distinct summaries the caller can see in the folder and all its subfolders (one in several of them counts once). */
  subtreeCount: number;
  /** Summaries placed directly in the folder that the caller lacks permissions to see. */
  hiddenCount: number;
  permissions: ReturnType<typeof toApiPermission>[];
  managers: string[];
  createdBy: ReturnType<typeof toRef>;
  createdAt: string;
  updatedAt: string;
}

/** A summary placed in a folder: 'summary' or 'running' (sumaroons are never placed in folders). */
export interface ApiFolderItem {
  _id: string;
  name: string;
  kind: 'summary' | 'running' | 'sumaroon';
}

const payloadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  /** create only; ignored on edit (moving is POST /folder/:id/move) */
  parentId: zId.nullish(),
  permissions: z.array(zId).max(100).default([]),
  managers: z.array(zId).max(200).default([]),
});

const moveSchema = z.object({ parentId: zId.nullable() });

const itemsSchema = z.object({
  summaryIds: z.array(zId).min(1).max(500),
  /** Bulk mode: place every eligible item and report the rest, instead of rejecting the whole request. */
  partial: z.boolean().default(false),
});

/**
 * Hierarchy rules (decision record F1–F6): folders are viewed by permissions (all-of, at least one,
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
    const rows = await this.repo.items(id, this.summaries.visible(me));
    return rows.map((s) => ({ _id: s.id, name: s.name, kind: s.kind }));
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

  /**
   * Add items to the folder, keeping the folders they are already in: another pointer to the same summary, not a move or
   * a copy. Needs folder management and only sight of each item (folders don't change who may see a summary).
   * Strict (default): every item must be placeable, else 404 (not visible) / 400 (a draft or a sumaroon), and nothing
   * is placed. `partial`: places the placeable ones and reports the rest.
   */
  async addItems(me: CurrentUser, id: string, body: unknown): Promise<ApiBulkResult> {
    const input = parse(itemsSchema, body);
    const summaryIds = unique(input.summaryIds);
    await this.assertEditable(me, id);

    const visibleSummaries = await this.summaries.visibleIds(me, summaryIds);
    const skipped: ApiBulkResult['skipped'] = summaryIds.filter((i) => !visibleSummaries.has(i)).map((i) => ({ id: i, reason: 'not-found' }));
    if (!input.partial && skipped.length) throw new NotFoundException();

    const placeable: string[] = [];
    for (const sid of summaryIds.filter((s) => visibleSummaries.has(s))) {
      const row = await this.summaries.findById(sid);
      const reason = row?.isDraft ? 'draft' : row?.kind === 'sumaroon' ? 'sumaroon' : null;
      if (reason && !input.partial)
        throw new BadRequestException(reason === 'draft' ? 'drafts cannot be placed in a folder' : 'a sumaroon lives only inside its running summary');
      if (reason) skipped.push({ id: sid, reason });
      else placeable.push(sid);
    }

    await this.database.transaction(async () => {
      if (!(await this.repo.lockForUpdate(id))) throw new NotFoundException();
      await this.repo.place(id, placeable);
      await this.repo.touch(id);
    });
    return { applied: placeable, skipped };
  }

  async removeItems(me: CurrentUser, id: string, body: unknown): Promise<void> {
    const summaryIds = unique(parse(itemsSchema, body).summaryIds);
    await this.assertEditable(me, id);
    await this.database.transaction(async () => {
      await this.repo.unplace(id, summaryIds);
      await this.repo.touch(id);
    });
  }

  /**
   * Move a folder (with its subtree) under `parentId`, or to the root with null. Needs management of the folder, of the
   * parent it leaves and of the one it enters. A folder cannot go inside itself.
   */
  async move(me: CurrentUser, id: string, body: unknown): Promise<ApiFolder | object> {
    const { parentId } = parse(moveSchema, body);
    await this.assertEditable(me, id);
    if (parentId) await this.assertEditable(me, parentId);
    await this.database.transaction(async () => {
      await this.repo.lockMoves();
      const folder = await this.repo.findById(id);
      if (!folder) throw new NotFoundException();
      if (folder.parentId === parentId) return;
      if (folder.parentId) await this.assertEditable(me, folder.parentId);
      if (parentId && (await this.repo.isWithin(parentId, id))) throw new BadRequestException('a folder cannot move inside itself');
      await this.repo.setParent(id, parentId);
    });
    // Under a stricter parent the caller may no longer see it.
    const [moved] = await this.hydrate(me, [...(await this.repo.visibleIds(me, [id]))]);
    return moved ?? {};
  }

  /** Deletes the folder and its subfolders; the summaries inside are only taken out of the hierarchy. */
  async delete(me: CurrentUser, id: string): Promise<void> {
    await this.assertEditable(me, id);
    await this.repo.delete(id);
  }

  private async hydrate(me: CurrentUser, ids: string[]): Promise<ApiFolder[]> {
    const [rows, counts, subtree] = await Promise.all([
      this.repo.loadFull(ids),
      this.repo.itemCounts(ids, this.summaries.visible(me)),
      this.repo.subtreeCounts(ids, this.summaries.visible(me)),
    ]);
    return rows.map((f) => ({
      _id: f.id,
      name: f.name,
      parentId: f.parentId,
      itemCount: counts.get(f.id)?.visible ?? 0,
      subtreeCount: subtree.get(f.id) ?? 0,
      hiddenCount: counts.get(f.id)?.hidden ?? 0,
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
