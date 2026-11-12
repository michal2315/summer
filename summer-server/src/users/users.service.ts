import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CurrentUser } from '../auth/identity-provider';
import { z } from 'zod';
import { ApiBulkResult, ApiUser } from '../common/api-types';
import { isUuid, parse, unique, zId } from '../common/validation';
import { DatabaseService } from '../database/database.service';
import { SAVED_SEARCH_KINDS, SavedSearchKind } from '../database/schema';
import { SEARCH_KEYS } from '../notifications/notifications.service';
import { summarySearchSchema } from '../summaries/summary-search';
import { LabelsRepository } from '../labels/labels.repository';
import { PermissionsRepository } from '../permissions/permissions.repository';
import { BULK_MAX } from '../summaries/summaries.service';
import { UserStateRepository } from './user-state.repository';
import { UsersRepository } from './users.repository';

const MAX_PINNED_SEARCH_BYTES = 4096;
const MAX_PINNED_SEARCHES = 50;
const MAX_SEARCH_NAME = 120;

type Body_ = Record<string, unknown> | undefined;

/** A blank name means "unnamed" (the client describes the search instead). */
function searchName(name: unknown): string | null {
  if (name === undefined || name === null) return null;
  if (typeof name !== 'string') throw new BadRequestException('name must be a string');
  return name.trim().slice(0, MAX_SEARCH_NAME) || null;
}

const bulkFavoriteSchema = z.object({ summaryIds: z.array(zId).min(1).max(BULK_MAX), favorite: z.boolean() });
/** Keys that do not distinguish one saved search from another. */
const IGNORED_SEARCH_KEYS = new Set(['sort', 'isPin', 'skip', 'limit']);
/** Request fields that are not part of the search itself. */
const META_KEYS = ['isPin', 'name', 'kind', 'isFavorite', 'skip', 'limit'];

/** Order-insensitive identity of a search (empty values ignored), optionally over some keys only. */
function searchKey(search: Record<string, unknown>, only?: string[]): string {
  const norm = Object.entries(search)
    .filter(([k, v]) => (only ? only.includes(k) : !IGNORED_SEARCH_KEYS.has(k)) && v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => [k, Array.isArray(v) ? [...v].map(String).sort() : typeof v === 'string' ? v.trim() : v] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(norm);
}

/** The search part of a request body, size-checked. */
function searchOf(body: Record<string, unknown>): Record<string, unknown> {
  const search = Object.fromEntries(Object.entries(body).filter(([k]) => !META_KEYS.includes(k)));
  if (JSON.stringify(search).length > MAX_PINNED_SEARCH_BYTES) throw new BadRequestException('search too large');
  return search;
}

/** What an alert keeps of a search (same filtering as the notification rules). */
const alertPart = (search: Record<string, unknown>) => Object.fromEntries(Object.entries(search).filter(([k, v]) => SEARCH_KEYS.includes(k) && v !== undefined && v !== null));

function searchKind(kind: unknown): SavedSearchKind {
  if (kind === undefined || kind === null) return 'simple';
  if (!SAVED_SEARCH_KINDS.includes(kind as SavedSearchKind)) throw new BadRequestException('kind must be simple or advanced');
  return kind as SavedSearchKind;
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
    const { isPin, name: rawName, kind: rawKind } = body as Record<string, unknown>;
    const search = searchOf(body as Record<string, unknown>);
    const name = searchName(rawName);
    const save = isPin === true || isPin === 'true';
    const kind = save ? searchKind(rawKind) : 'simple';
    const key = searchKey(search);
    await this.database.transaction(async () => {
      const existing = await this.state.pinnedSearches(me.id);
      const same = existing.filter((s) => searchKey(s.search) === key);
      for (const s of same) await this.state.deletePinnedSearch(s.id);
      if (save) {
        if (existing.length - same.length >= MAX_PINNED_SEARCHES) throw new BadRequestException('too many pinned searches');
        // Saving the same search again moves it to the top and keeps its name and favourite unless a new name is given.
        await this.state.addPinnedSearch(me.id, {
          search,
          name: name ?? same.find((s) => s.name)?.name ?? null,
          kind,
          isFavorite: same.some((s) => s.isFavorite),
        });
      }
    });
    return this.me(me);
  }

  /**
   * Change a saved search's name, favourite, or the search itself (its kind stays). A new search may not equal another
   * saved one, and the alert on the old search follows it.
   */
  async updateSearch(me: CurrentUser, id: string, body: Body_): Promise<ApiUser> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException();
    const patch: { name?: string | null; search?: Record<string, unknown>; isFavorite?: boolean } = {};
    if ('name' in body) patch.name = searchName(body.name);
    if ('isFavorite' in body) {
      if (typeof body.isFavorite !== 'boolean') throw new BadRequestException('isFavorite must be a boolean');
      patch.isFavorite = body.isFavorite;
    }
    if ('search' in body) {
      const raw = body.search;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('search must be an object');
      patch.search = searchOf(raw as Record<string, unknown>);
      if (searchKey(patch.search) === searchKey({})) throw new BadRequestException('search is empty');
      if (!summarySearchSchema.safeParse(alertPart(patch.search)).success) throw new BadRequestException('invalid search');
    }
    await this.database.transaction(async () => {
      const all = await this.state.pinnedSearches(me.id);
      const current = all.find((s) => s.id === id);
      if (!current) throw new NotFoundException();
      if (patch.search) {
        const key = searchKey(patch.search);
        const clash = all.find((s) => s.id !== id && searchKey(s.search) === key);
        if (clash) throw new ConflictException(clash.name ? `already saved as "${clash.name}"` : 'this search is already saved');
        const oldAlertKey = searchKey(current.search, SEARCH_KEYS);
        if (searchKey(patch.search, SEARCH_KEYS) !== oldAlertKey) {
          for (const rule of await this.state.searchAlerts(me.id))
            if (rule.search && searchKey(rule.search, SEARCH_KEYS) === oldAlertKey) await this.state.setAlertSearch(rule.id, alertPart(patch.search));
        }
      }
      if (Object.keys(patch).length) await this.state.updatePinnedSearch(me.id, id, patch);
    });
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
