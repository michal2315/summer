import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CurrentUser } from '../auth/identity-provider';
import { z } from 'zod';
import { ApiBulkResult, ApiUser } from '../common/api-types';
import { preferencesSchema } from '../common/preferences';
import { isUuid, parse, unique, zId } from '../common/validation';
import { DatabaseService } from '../database/database.service';
import { LabelsRepository } from '../labels/labels.repository';
import { PermissionsRepository } from '../permissions/permissions.repository';
import { BULK_MAX } from '../summaries/summaries.service';
import { UserStateRepository } from './user-state.repository';
import { UsersRepository } from './users.repository';

const bulkFavoriteSchema = z.object({ summaryIds: z.array(zId).min(1).max(BULK_MAX), favorite: z.boolean() });

/** Pins, favourites and follows. Every mutation returns the caller's refreshed IUser, which the client caches. */
@Injectable()
export class UsersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly users: UsersRepository,
    private readonly state: UserStateRepository,
    private readonly labels: LabelsRepository,
    private readonly permissions: PermissionsRepository,
  ) {}

  async me(me: CurrentUser): Promise<ApiUser> {
    const user = await this.users.apiUser(me.id);
    if (!user) throw new NotFoundException();
    return user;
  }

  /** Change some preferences (keys left out stay as they are). */
  async setPreferences(me: CurrentUser, body: unknown): Promise<ApiUser> {
    const patch = parse(preferencesSchema, body ?? {});
    await this.users.setPreferences(me.id, patch);
    return this.me(me);
  }

  async toggleLabel(me: CurrentUser, kind: 'pinned' | 'favorite', name: unknown): Promise<ApiUser> {
    if (typeof name !== 'string' || !name.trim()) throw new BadRequestException('label is required');
    const labelId = await this.labels.idByName(name);
    if (!labelId) throw new NotFoundException('unknown label');
    await this.state.toggleLabel(kind, me.id, labelId);
    return this.me(me);
  }

  async togglePinnedPermission(me: CurrentUser, permissionId: unknown): Promise<ApiUser> {
    if (!isUuid(permissionId) || !(await this.permissions.byIds([permissionId])).length) throw new NotFoundException();
    await this.state.togglePinnedPermission(me.id, permissionId);
    return this.me(me);
  }

  /** Removing always works; adding needs an active, non-system user other than the caller. */
  async togglePinnedUser(me: CurrentUser, userId: unknown): Promise<ApiUser> {
    if (!isUuid(userId)) throw new NotFoundException();
    if (userId === me.id) throw new BadRequestException('cannot pin yourself');
    await this.state.togglePinnedUser(me.id, userId, async () => {
      if (!(await this.users.existingIds([userId])).length) throw new NotFoundException();
    });
    return this.me(me);
  }

  /** A favourite is only added for a summary the caller can see; removing always works. */
  async toggleFavoriteSummary(me: CurrentUser, summaryId: unknown): Promise<ApiUser> {
    if (!isUuid(summaryId)) throw new NotFoundException();
    await this.state.toggleFavoriteSummary(me.id, summaryId, async () => {
      if (!(await this.state.canSeeSummary(me, summaryId))) throw new NotFoundException();
      return true;
    });
    return this.me(me);
  }

  /** Add (only summaries the caller can see) or remove many favourites at once. */
  async bulkFavorite(me: CurrentUser, body: unknown): Promise<ApiBulkResult> {
    const p = parse(bulkFavoriteSchema, body);
    const ids = unique(p.summaryIds);
    const visible = p.favorite ? await this.state.visibleSummaryIds(me, ids) : new Set(ids);
    const applied = ids.filter((id) => visible.has(id));
    await this.state.setFavoriteSummaries(me.id, applied, p.favorite);
    return { applied, skipped: ids.filter((id) => !visible.has(id)).map((id) => ({ id, reason: 'not-found' as const })) };
  }

  async follow(me: CurrentUser, userId: string): Promise<ApiUser> {
    if (userId === me.id) throw new BadRequestException('cannot follow yourself');
    if (!(await this.users.existingIds([userId])).length) throw new NotFoundException();
    await this.state.follow(me.id, userId);
    return this.me(me);
  }

  async unfollow(me: CurrentUser, userId: string): Promise<ApiUser> {
    await this.state.unfollow(me.id, userId);
    return this.me(me);
  }
}
