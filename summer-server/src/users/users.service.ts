import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CurrentUser } from '../auth/identity-provider';
import { z } from 'zod';
import { ApiBulkResult, ApiUser } from '../common/api-types';
import { isUuid, parse, unique, zId } from '../common/validation';
import { DatabaseService } from '../database/database.service';
import { LabelsRepository } from '../labels/labels.repository';
import { PermissionsRepository } from '../permissions/permissions.repository';
import { BULK_MAX } from '../summaries/summaries.service';
import { UserStateRepository } from './user-state.repository';
import { UsersRepository } from './users.repository';

const MAX_PINNED_SEARCH_BYTES = 4096;
const MAX_PINNED_SEARCHES = 50;
const MAX_SEARCH_NAME = 120;

/** A blank name means "unnamed" (the client describes the search instead). */
function searchName(name: unknown): string | null {
  if (name === undefined || name === null) return null;
  if (typeof name !== 'string') throw new BadRequestException('name must be a string');
  return name.trim().slice(0, MAX_SEARCH_NAME) || null;
}

const bulkFavoriteSchema = z.object({ summaryIds: z.array(zId).min(1).max(BULK_MAX), favorite: z.boolean() });
/** Keys that do not distinguish one saved search from another. */
const IGNORED_SEARCH_KEYS = new Set(['sort', 'isPin', 'skip', 'limit']);

/** Order-insensitive identity of a saved search (empty values ignored). */
function searchKey(search: Record<string, unknown>): string {
  const norm = Object.entries(search)
    .filter(([k, v]) => !IGNORED_SEARCH_KEYS.has(k) && v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => [k, Array.isArray(v) ? [...v].map(String).sort() : v] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(norm);
}

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

  async pinSearch(me: CurrentUser, body: unknown): Promise<ApiUser> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException();
    const { isPin, name: rawName, ...search } = body as Record<string, unknown>;
    for (const k of ['skip', 'limit']) delete search[k];
    if (JSON.stringify(search).length > MAX_PINNED_SEARCH_BYTES) throw new BadRequestException('search too large');
    const name = searchName(rawName);
    const key = searchKey(search);
    await this.database.transaction(async () => {
      const existing = await this.state.pinnedSearches(me.id);
      const same = existing.filter((s) => searchKey(s.search) === key);
      for (const s of same) await this.state.deletePinnedSearch(s.id);
      if (isPin === true || isPin === 'true') {
        if (existing.length - same.length >= MAX_PINNED_SEARCHES) throw new BadRequestException('too many pinned searches');
        // Saving the same search again moves it to the top and keeps its name unless a new one is given.
        await this.state.addPinnedSearch(me.id, search, name ?? same.find((s) => s.name)?.name ?? null);
      }
    });
    return this.me(me);
  }

  async renameSearch(me: CurrentUser, id: string, name: unknown): Promise<ApiUser> {
    if (!(await this.state.renamePinnedSearch(me.id, id, searchName(name)))) throw new NotFoundException();
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
