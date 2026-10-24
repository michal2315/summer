import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and } from 'drizzle-orm';
import { z } from 'zod';
import { CurrentUser } from '../auth/identity-provider';
import { ApiCollection, ApiCollectionRef, ApiSummary, SummaryLengths, toApiPermission, toRef } from '../common/api-types';
import { parse, unique, zBoolString, zId } from '../common/validation';
import { DatabaseService } from '../database/database.service';
import { validPermissionSet } from '../permissions/permission-assignment';
import { PermissionsRepository } from '../permissions/permissions.repository';
import { SummariesRepository } from '../summaries/summaries.repository';
import { SummariesService } from '../summaries/summaries.service';
import { SummarySearch } from '../summaries/summary-search';
import { validUserSet } from '../users/user-set';
import { UsersRepository } from '../users/users.repository';
import { collectionVisible } from './collection.access';
import { CollectionsRepository } from './collections.repository';

export const listQuery = z.object({
  skip: z.coerce.number().int().min(0).max(100_000).default(0),
  text: z.string().max(120).default(''),
  /** 'false' → only collections the caller manages */
  all: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v !== 'false'),
  getPrioritized: zBoolString,
});

const payloadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  permissions: z.array(zId).max(100).default([]),
  managers: z.array(zId).max(200).default([]),
  /** edit only: summary ids to remove from the collection */
  summaries: z.array(zId).max(10_000).default([]),
});

const addSchema = z.object({
  collectionIds: z.array(zId).min(1).max(100),
  summaryIds: z.array(zId).min(1).max(1000),
});

/**
 * Collection rules: viewing is all-of its permissions; managers (collection editors) edit metadata and remove
 * members; adding a summary needs view access to the collection and edit access to the summary (handoff §3).
 */
@Injectable()
export class CollectionsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly repo: CollectionsRepository,
    private readonly summaries: SummariesService,
    private readonly summaryRepo: SummariesRepository,
    private readonly permissions: PermissionsRepository,
    private readonly users: UsersRepository,
  ) {}

  async get(me: CurrentUser, id: string): Promise<ApiCollection> {
    await this.assertVisible(me, id);
    const [c] = await this.hydrate(me, [id]);
    return c;
  }

  async list(me: CurrentUser, query: unknown): Promise<ApiCollection[]> {
    const q = parse(listQuery, query);
    const ids = await this.repo.listIds({
      visible: collectionVisible(me),
      text: q.text.trim(),
      managedBy: q.all ? undefined : me.id,
      prioritizeFor: q.getPrioritized ? me.id : undefined,
      skip: q.skip,
    });
    return this.hydrate(me, ids);
  }

  async refsByName(me: CurrentUser, text: string): Promise<ApiCollectionRef[]> {
    const rows = await this.repo.refs(and(collectionVisible(me), this.repo.byNameCondition(text.trim()))!);
    return rows.map((r) => ({ _id: r.id, name: r.name }));
  }

  async refsByIds(me: CurrentUser, ids: string[]): Promise<ApiCollectionRef[]> {
    if (!ids.length) return [];
    const rows = await this.repo.refs(and(collectionVisible(me), this.repo.byIdsCondition(ids))!, ids.length);
    return rows.map((r) => ({ _id: r.id, name: r.name }));
  }

  async summariesOf(me: CurrentUser, id: string, search: SummarySearch): Promise<{ summaries: ApiSummary[]; lengths: SummaryLengths }> {
    await this.assertVisible(me, id);
    return this.summaries.inCollection(me, id, search);
  }

  async create(me: CurrentUser, body: unknown): Promise<ApiCollection> {
    const p = parse(payloadSchema, body);
    const permissionIds = await validPermissionSet(this.permissions, me, p.permissions, { required: true, what: 'a collection' });
    const managers = await validUserSet(this.users, [me.id, ...p.managers], 'manager');
    const id = await this.database.transaction(async () => {
      const cid = await this.repo.insert(p.name, me.id);
      await this.repo.replacePermissions(cid, permissionIds);
      await this.repo.replaceEditors(cid, managers);
      return cid;
    });
    return this.get(me, id);
  }

  async edit(me: CurrentUser, id: string, body: unknown): Promise<ApiCollection> {
    const p = parse(payloadSchema, body);
    await this.assertEditable(me, id);
    const permissionIds = await validPermissionSet(this.permissions, me, p.permissions, { required: true, what: 'a collection' });
    const managers = p.managers.length ? await validUserSet(this.users, p.managers, 'manager') : null;
    await this.database.transaction(async () => {
      if (!(await this.repo.lockForUpdate(id))) throw new NotFoundException();
      await this.assertEditable(me, id);
      await this.repo.update(id, { name: p.name });
      await this.repo.replacePermissions(id, permissionIds);
      if (managers) await this.repo.replaceEditors(id, managers);
      await this.repo.removeMemberships(id, unique(p.summaries));
    });
    // The caller may have removed themselves from the managers or narrowed the permissions.
    return (await this.repo.visibleIds(me, [id])).has(id) ? this.get(me, id) : ({} as ApiCollection);
  }

  async addSummaries(me: CurrentUser, body: unknown): Promise<void> {
    const p = parse(addSchema, body);
    const collectionIds = unique(p.collectionIds);
    const summaryIds = unique(p.summaryIds);
    const visible = await this.repo.visibleIds(me, collectionIds);
    if (collectionIds.some((c) => !visible.has(c))) throw new NotFoundException();
    if ((await this.summaries.onlySumaroons(summaryIds)).length) throw new BadRequestException('a sumaroon lives only inside its running summary');
    const editable = await this.summaryRepo.visibleIds(me, summaryIds, 'edit');
    if (summaryIds.some((s) => !editable.has(s))) throw new ForbiddenException('only a summary editor may add it to a collection');
    await this.database.transaction(async () => {
      await this.repo.addMemberships(collectionIds.flatMap((collectionId) => summaryIds.map((summaryId) => ({ collectionId, summaryId }))));
      await this.repo.touch(collectionIds);
    });
  }

  /** Deletes the collection and its memberships; the summaries themselves are kept. */
  async delete(me: CurrentUser, id: string): Promise<void> {
    await this.assertEditable(me, id);
    await this.repo.delete(id);
  }

  private async hydrate(me: CurrentUser, ids: string[]): Promise<ApiCollection[]> {
    const [rows, members] = await Promise.all([this.repo.loadFull(ids), this.repo.visibleSummaryIds(ids, this.summaryRepo.visible(me))]);
    return rows.map((c) => ({
      _id: c.id,
      name: c.name,
      permissions: c.permissions.map((p) => toApiPermission(p.permission)).sort((a, b) => a.name.localeCompare(b.name, 'he')),
      summaries: members.get(c.id) ?? [],
      managers: c.editors.map((e) => e.userId),
      createdBy: toRef(c.author),
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      isDeleted: false,
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
