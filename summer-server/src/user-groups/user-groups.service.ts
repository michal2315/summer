import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/identity-provider';
import { ApiUserGroup } from '../common/api-types';
import { parse, unique, zId } from '../common/validation';
import { DatabaseService } from '../database/database.service';
import { PermissionsRepository } from '../permissions/permissions.repository';
import { validUserSet } from '../users/user-set';
import { UsersRepository } from '../users/users.repository';
import { UserGroupWithMembers, UserGroupsRepository } from './user-groups.repository';

const MAX_GROUPS = 100;
const SHARED_PAGE = 30;

const name = z.string().trim().min(1).max(80);
const members = {
  users: z.array(zId).max(200),
  permissions: z.array(zId).max(100),
};

const createBody = z.object({
  name,
  users: members.users.default([]),
  permissions: members.permissions.default([]),
  isFavorite: z.boolean().default(false),
  isShared: z.boolean().default(false),
});

const updateBody = z.object({
  name: name.optional(),
  users: members.users.optional(),
  permissions: members.permissions.optional(),
  isFavorite: z.boolean().optional(),
  isShared: z.boolean().optional(),
});

const copyBody = z.object({ name: name.optional() });

const sharedQuery = z.object({
  q: z.string().trim().max(120).default(''),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

const toApi =
  (me: CurrentUser) =>
  ({ group: g, owner, users, permissions }: UserGroupWithMembers): ApiUserGroup => ({
    _id: g.id,
    name: g.name,
    users,
    permissions,
    isFavorite: g.ownerId === me.id && g.isFavorite,
    isShared: g.isShared,
    isMine: g.ownerId === me.id,
    owner,
    creationDate: g.createdAt.toISOString(),
    updateDate: g.updatedAt.toISOString(),
  });

/**
 * User groups: named sets of users and permission groups that are tagged together. Only the owner changes one;
 * a shared one can be found, used and copied by everyone. Names are unique per owner.
 */
@Injectable()
export class UserGroupsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly repo: UserGroupsRepository,
    private readonly users: UsersRepository,
    private readonly permissions: PermissionsRepository,
  ) {}

  list(me: CurrentUser): Promise<ApiUserGroup[]> {
    return this.repo.ownedBy(me.id).then((rows) => rows.map(toApi(me)));
  }

  /** Others' shared groups, a page at a time; `q` narrows by name or owner. */
  async shared(me: CurrentUser, query: unknown): Promise<ApiUserGroup[]> {
    const { q, offset } = parse(sharedQuery, query);
    return (await this.repo.shared(me.id, q, SHARED_PAGE, offset)).map(toApi(me));
  }

  async create(me: CurrentUser, body: unknown): Promise<ApiUserGroup> {
    const input = parse(createBody, body);
    const id = await this.database.transaction(() => this.insertMine(me, input));
    return this.get(me, id);
  }

  /** A private copy of a group (the caller's or a shared one) as the caller's own. */
  async copy(me: CurrentUser, id: string, body: unknown): Promise<ApiUserGroup> {
    const { name } = parse(copyBody, body ?? {});
    const source = await this.get(me, id);
    const newId = await this.database.transaction(() =>
      this.insertMine(me, {
        name: name ?? (source.isMine ? `${source.name} (עותק)` : source.name),
        users: source.users.map((u) => u._id),
        permissions: source.permissions,
        isFavorite: false,
        isShared: false,
      }),
    );
    return this.get(me, newId);
  }

  async update(me: CurrentUser, id: string, body: unknown): Promise<ApiUserGroup> {
    const input = parse(updateBody, body);
    await this.database.transaction(async () => {
      const current = await this.owned(me, id);
      if (input.name !== undefined) await this.assertNameFree(me, input.name, id);
      if (input.users !== undefined || input.permissions !== undefined) {
        const userIds = await this.validUsers(input.users ?? current.users.map((u) => u._id));
        const permissionIds = await this.validPermissions(input.permissions ?? current.permissions);
        this.assertNotEmpty(userIds, permissionIds);
        await this.repo.setMembers(id, userIds, permissionIds);
      }
      await this.repo.update(me.id, id, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.isFavorite !== undefined ? { isFavorite: input.isFavorite } : {}),
        ...(input.isShared !== undefined ? { isShared: input.isShared } : {}),
      });
    });
    return this.get(me, id);
  }

  async remove(me: CurrentUser, id: string): Promise<void> {
    await this.owned(me, id);
    if (!(await this.repo.delete(me.id, id))) throw new NotFoundException();
  }

  private async get(me: CurrentUser, id: string): Promise<ApiUserGroup> {
    const row = await this.repo.one(me.id, id);
    if (!row) throw new NotFoundException();
    return toApi(me)(row);
  }

  /** Only the owner changes or deletes a group. */
  private async owned(me: CurrentUser, id: string): Promise<UserGroupWithMembers> {
    const row = await this.repo.one(me.id, id);
    if (!row) throw new NotFoundException();
    if (row.group.ownerId !== me.id) throw new ForbiddenException('only the owner can change this user group');
    return row;
  }

  private async insertMine(me: CurrentUser, input: z.output<typeof createBody>): Promise<string> {
    if ((await this.repo.countOwned(me.id)) >= MAX_GROUPS) throw new BadRequestException(`up to ${MAX_GROUPS} user groups`);
    await this.assertNameFree(me, input.name);
    const userIds = await this.validUsers(input.users);
    const permissionIds = await this.validPermissions(input.permissions);
    this.assertNotEmpty(userIds, permissionIds);
    const row = await this.repo.insert(me.id, { name: input.name, isFavorite: input.isFavorite, isShared: input.isShared });
    await this.repo.setMembers(row.id, userIds, permissionIds);
    return row.id;
  }

  private async assertNameFree(me: CurrentUser, name: string, except?: string): Promise<void> {
    const clash = await this.repo.ownedByName(me.id, name);
    if (clash && clash.id !== except) throw new ConflictException(`a user group named "${clash.name}" already exists`);
  }

  private validUsers(ids: string[]): Promise<string[]> {
    return validUserSet(this.users, ids, 'users');
  }

  private async validPermissions(ids: string[]): Promise<string[]> {
    const permissionIds = unique(ids);
    if ((await this.permissions.byIds(permissionIds)).length !== permissionIds.length) throw new BadRequestException('unknown permission groups');
    return permissionIds;
  }

  private assertNotEmpty(userIds: string[], permissionIds: string[]): void {
    if (!userIds.length && !permissionIds.length) throw new BadRequestException('a user group needs at least one user or group');
  }
}
