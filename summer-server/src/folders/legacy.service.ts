import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { CurrentUser } from '../auth/identity-provider';
import { ApiBulkResult, ApiPermission, UserRef, toApiPermission } from '../common/api-types';
import { parse, unique, zId } from '../common/validation';
import { DatabaseService } from '../database/database.service';
import { SummariesRepository } from '../summaries/summaries.repository';
import { SummariesService } from '../summaries/summaries.service';
import { folderVisible } from './folder.access';
import { ApiFolder, ApiFolderItem, FoldersService } from './folders.service';
import { FoldersRepository } from './folders.repository';
import { LegacyRepository } from './legacy.repository';
import { UsersRepository } from '../users/users.repository';

export interface ApiLegacyCollection {
  folder: ApiFolder;
  /** Placements when it was put in the legacy root. */
  total: number;
  /** Placements still in it, including ones the caller cannot see (folder.hiddenCount of them). */
  left: number;
}

export interface ApiLegacyOverview {
  /** null: there is no legacy root (nothing was imported). */
  rootId: string | null;
  /** The collections still in the legacy root that the caller manages. */
  collections: ApiLegacyCollection[];
  /**
   * The caller's own summaries that the old Summer had in no collection, waiting directly in the legacy root; shown
   * like a collection (its folder is the root, named UNFILED_NAME). null when none are left.
   */
  unfiled: ApiLegacyCollection | null;
  /**
   * Collections in the legacy root the caller does not manage but wrote summaries in: `left` / `total` count only the
   * caller's own (they sort those themselves), with who manages each collection.
   */
  authored: ApiLegacyAuthored[];
  /**
   * Over every collection the caller manages or managed (including ones already moved out or deleted), the unfiled, and
   * the caller's own summaries in collections of others.
   */
  progress: { total: number; left: number; collections: number; done: number };
}

export interface ApiLegacyAuthored extends ApiLegacyCollection {
  managers: UserRef[];
  /** The caller's own summaries already taken out of it (by its managers or by the caller), and where they are now. */
  sorted: ApiLegacySorted[];
}

export interface ApiLegacySorted {
  _id: string;
  name: string;
  kind: ApiFolderItem['kind'];
  /** Folders outside the legacy root it is in now that the caller can see; none and no hiddenFolders = in no folder. */
  folders: ApiFolderRefLite[];
  /** Folders outside the legacy root it is in that the caller can't see. */
  hiddenFolders: number;
}

/**
 * Where staging acts: a collection the caller manages (all its summaries), or, with `own`, the legacy root itself (the
 * caller's unfiled summaries) or a collection someone else manages: only the summaries the caller wrote.
 */
interface Scope {
  rootId: string;
  own: boolean;
}

/** What the staging page calls the caller's summaries waiting directly in the legacy root. */
export const UNFILED_NAME = 'התמציות שלי ללא תיקייה';

export interface ApiFolderRefLite {
  _id: string;
  name: string;
}

export interface ApiLegacyItem extends ApiFolderItem {
  /** Folders outside the legacy root it is already in ("already moved to …"). */
  alsoIn: ApiFolderRefLite[];
  /** Other legacy collections it is also waiting in. */
  alsoLegacy: ApiFolderRefLite[];
  /** Its own permissions (viewing needs all of them): the client warns before placing it in a narrower folder. */
  permissions: ApiPermission[];
}

export interface ApiLegacyMoveResult extends ApiBulkResult {
  /** Of `applied`, the ones that were not in the target before (undo takes only these out of it again). */
  added: string[];
  /** Placements left in the collection afterwards. */
  left: number;
}

export interface ApiLegacySearch {
  /** Collection id → the ids of its summaries that match (only collections with a match). */
  matches: Record<string, string[]>;
  /** More summaries matched than SEARCH_CAP: some may be missing. */
  capped: boolean;
}

/** The most summaries a staging search returns. */
const SEARCH_CAP = 5000;

/** A search as the home page's box emits it (ISummarySearch); parseSearch validates it. */
const searchSchema = z.object({ search: z.record(z.string(), z.unknown()) });
const idsSchema = z.object({ summaryIds: z.array(zId).min(1).max(500) });
const moveSchema = idsSchema.extend({ to: zId });

/**
 * The staging page (/staging): sorting the collections imported from the old Summer into the hierarchy. Collections
 * are flat folders in the legacy root; their managers sort them, for everyone, and authors may sort their own
 * summaries out of any collection (and out of the root itself, where the unfiled ones wait). Each placement is sorted
 * on its own: a summary in two collections stays in the other until that one is sorted too. Summaries and whole collections only
 * leave the legacy root; the one way back in is undoing a move (a summary needs its release row, a collection its
 * progress row).
 */
@Injectable()
export class LegacyService {
  constructor(
    private readonly database: DatabaseService,
    private readonly repo: LegacyRepository,
    private readonly folders: FoldersService,
    private readonly folderRepo: FoldersRepository,
    private readonly summaries: SummariesRepository,
    private readonly summarySearch: SummariesService,
    private readonly users: UsersRepository,
  ) {}

  async overview(me: CurrentUser): Promise<ApiLegacyOverview> {
    const rootId = await this.repo.rootId();
    if (!rootId) return { rootId: null, collections: [], unfiled: null, authored: [], progress: { total: 0, left: 0, collections: 0, done: 0 } };
    await this.repo.register(rootId);
    const [ids, others] = await Promise.all([this.repo.editableCollections(me, rootId), this.repo.authoredCollections(me, rootId)]);
    const [hydrated, left, totals, progress, unfiled] = await Promise.all([
      this.folders.hydrate(me, [...ids, rootId, ...others.map((o) => o.id)]),
      this.repo.leftCounts(ids),
      this.repo.totals(ids),
      this.repo.progress(me, rootId),
      this.repo.unfiledCounts(rootId, me.id),
    ]);
    const byId = new Map(hydrated.map((f) => [f._id, f]));
    const managers = new Map((await this.users.refsByIds(unique(others.flatMap((o) => byId.get(o.id)?.managers ?? [])))).map((u) => [u._id, u]));
    const collections = ids.flatMap((id) => {
      const folder = byId.get(id);
      return folder ? [{ folder, left: left.get(id) ?? 0, total: Math.max(totals.get(id) ?? 0, left.get(id) ?? 0) }] : [];
    });
    // Only the caller's own summaries count in the unfiled and in others' collections, so none are hidden from them there.
    const root = byId.get(rootId);
    const unfiledTotal = unfiled.left + unfiled.released;
    const sorted = await this.sortedOut(me, rootId, others.filter((o) => o.released).map((o) => o.id));
    // Kept while anything of the caller's is left in it, or was sorted out of it (so they see it was done).
    const authored = others.flatMap((o) => {
      const folder = byId.get(o.id);
      if (!folder) return [];
      return [
        {
          folder: { ...folder, hiddenCount: 0 },
          left: o.left,
          total: o.left + o.released,
          managers: folder.managers.flatMap((m) => managers.get(m) ?? []),
          sorted: sorted.get(o.id) ?? [],
        },
      ];
    });
    const authoredLeft = others.reduce((n, o) => n + o.left, 0);
    const authoredTotal = others.reduce((n, o) => n + o.left + o.released, 0);
    const leftAll = collections.reduce((n, c) => n + c.left, 0);
    return {
      rootId,
      collections,
      unfiled: root && unfiled.left ? { folder: { ...root, name: UNFILED_NAME, hiddenCount: 0 }, left: unfiled.left, total: unfiledTotal } : null,
      authored,
      progress: {
        ...progress,
        total: Math.max(progress.total, leftAll) + unfiledTotal + authoredTotal,
        left: leftAll + unfiled.left + authoredLeft,
      },
    };
  }

  async items(me: CurrentUser, id: string): Promise<ApiLegacyItem[]> {
    const { rootId, own } = await this.assertCollection(me, id);
    const visible = await this.folderRepo.items(id, this.summaries.visible(me));
    const rows = own ? visible.filter((r) => r.createdBy === me.id) : visible;
    const ids = rows.map((r) => r.id);
    const [others, perms] = await Promise.all([this.repo.otherFolders(ids, id, folderVisible(me), rootId), this.repo.summaryPermissions(ids)]);
    // Also waiting in the root: among its author's unfiled summaries (not necessarily the caller's).
    const ref = (o: { id: string; name: string }) => ({ _id: o.id, name: o.id === rootId ? 'תמציות ללא לקט' : o.name });
    return rows.map((s) => {
      const mine = others.filter((o) => o.summaryId === s.id);
      return {
        _id: s.id,
        name: s.name,
        kind: s.kind,
        mine: s.createdBy === me.id,
        alsoIn: mine.filter((o) => !o.legacy).map(ref),
        alsoLegacy: mine.filter((o) => o.legacy).map(ref),
        permissions: perms.filter((p) => p.summaryId === s.id).map(toApiPermission),
      };
    });
  }

  /**
   * The home page's search-box syntax (operators, @user, :field:value, #capsule) over the summaries waiting in the
   * collections the caller manages: which summaries in each collection match.
   */
  async search(me: CurrentUser, body: unknown): Promise<ApiLegacySearch> {
    const { search } = parse(searchSchema, body);
    const rootId = await this.repo.rootId();
    if (!rootId) return { matches: {}, capped: false };
    const [ids, others, { left: unfiledLeft }] = await Promise.all([
      this.repo.editableCollections(me, rootId),
      this.repo.authoredCollections(me, rootId),
      this.repo.unfiledCounts(rootId, me.id),
    ]);
    // Where only the caller's own summaries count: the root itself and collections of others.
    const ownOnly = new Set([...(unfiledLeft ? [rootId] : []), ...others.filter((o) => o.left).map((o) => o.id)]);
    if (!ids.length && !ownOnly.size) return { matches: {}, capped: false };
    // Within the collections (or, with any own-only place, the whole root), published only; sumaroons are never placed
    // in a folder themselves (they go with their running summary).
    const f = this.summarySearch.parseSearch({
      ...search,
      folders: ownOnly.size ? [rootId] : ids,
      noFolder: false,
      kinds: ['summary', 'running'],
      parentId: undefined,
      summarySearch: 'SUMMARY',
      isProfile: false,
      skip: 0,
      limit: undefined,
    });
    const found = await this.summarySearch.searchAllIds(me, f, SEARCH_CAP + 1);
    const matches: Record<string, string[]> = {};
    for (const p of await this.repo.placements([...ids, ...ownOnly], found.slice(0, SEARCH_CAP)))
      if (!ownOnly.has(p.folderId) || p.createdBy === me.id) (matches[p.folderId] ??= []).push(p.summaryId);
    return { matches, capped: found.length > SEARCH_CAP };
  }

  /** Move summaries from the collection into `to` (a folder outside the legacy root the caller manages). */
  async moveItems(me: CurrentUser, id: string, body: unknown): Promise<ApiLegacyMoveResult> {
    const input = parse(moveSchema, body);
    const scope = await this.assertCollection(me, id);
    if (input.to === id) throw new BadRequestException('pick another folder');
    return this.database.transaction(async () => {
      const ids = await this.waitingIn(me, scope, id, input.summaryIds);
      if (!ids.length) return { applied: [], skipped: [], added: [], left: await this.leftOf(me, scope, id) };
      const before = await this.repo.placedIn(input.to, ids);
      // Checks the target (managed, not legacy) and each summary, and places the placeable ones.
      const result = await this.folders.addItems(me, input.to, { summaryIds: ids, partial: true });
      await this.repo.release(id, result.applied);
      await this.folderRepo.touch(id);
      return { ...result, added: result.applied.filter((s) => !before.has(s)), left: await this.leftOf(me, scope, id) };
    });
  }

  /**
   * Take summaries out of the collection without placing them anywhere (already sorted, or need no folder). From the
   * unfiled (the root itself) this is "keep as is": they become summaries in no folder.
   */
  async releaseItems(me: CurrentUser, id: string, body: unknown): Promise<{ applied: string[]; left: number }> {
    const { summaryIds } = parse(idsSchema, body);
    const scope = await this.assertCollection(me, id);
    return this.database.transaction(async () => {
      const ids = await this.waitingIn(me, scope, id, summaryIds);
      await this.repo.release(id, ids);
      await this.folderRepo.touch(id);
      return { applied: ids, left: await this.leftOf(me, scope, id) };
    });
  }

  /** Undo: put summaries taken out of the collection back in. */
  async restoreItems(me: CurrentUser, id: string, body: unknown): Promise<{ applied: string[]; left: number }> {
    const { summaryIds } = parse(idsSchema, body);
    const scope = await this.assertCollection(me, id);
    return this.database.transaction(async () => {
      const ids = scope.own ? await this.repo.writtenBy(me.id, unique(summaryIds)) : unique(summaryIds);
      const applied = await this.repo.restore(id, ids);
      return { applied, left: await this.leftOf(me, scope, id) };
    });
  }

  /**
   * Undo moving a whole collection out: back into the legacy root. Only a registered collection, still flat (no
   * subfolders), by its managers and the managers of the folder it is in now.
   */
  async restoreCollection(me: CurrentUser, id: string): Promise<object> {
    await this.folders.assertEditable(me, id);
    const rootId = await this.repo.rootId();
    if (!rootId || !(await this.repo.collection(id))) throw new BadRequestException('only a collection from the old Summer can go back');
    await this.database.transaction(async () => {
      await this.folderRepo.lockMoves();
      const folder = await this.folderRepo.findById(id);
      if (!folder) throw new NotFoundException();
      if (folder.parentId === rootId) return;
      if (await this.repo.hasSubfolders(id)) throw new BadRequestException('the collection has subfolders now');
      if (folder.parentId) await this.folders.assertEditable(me, folder.parentId);
      await this.folderRepo.setParent(id, rootId);
    });
    return {};
  }

  /** Per collection: the caller's own summaries taken out of it, with the folders outside the legacy root they are in now. */
  private async sortedOut(me: CurrentUser, rootId: string, collectionIds: string[]): Promise<Map<string, ApiLegacySorted[]>> {
    const released = await this.repo.ownReleased(collectionIds, me.id);
    const out = new Map<string, ApiLegacySorted[]>();
    if (!released.length) return out;
    // Every folder they are in (the root is never one of them), then which of those the caller may see.
    const placed = (await this.repo.otherFolders(unique(released.map((r) => r.summaryId)), rootId, sql`true`, rootId)).filter((p) => !p.legacy);
    const visible = await this.folderRepo.visibleIds(me, unique(placed.map((p) => p.id)));
    for (const r of released) {
      const where = placed.filter((p) => p.summaryId === r.summaryId);
      const entry = {
        _id: r.summaryId,
        name: r.name,
        kind: r.kind,
        folders: where.filter((p) => visible.has(p.id)).map((p) => ({ _id: p.id, name: p.name })),
        hiddenFolders: where.filter((p) => !visible.has(p.id)).length,
      };
      out.set(r.folderId, [...(out.get(r.folderId) ?? []), entry]);
    }
    return out;
  }

  /** Of `summaryIds`, the ones waiting in the collection (with `own`: and written by the caller). */
  private async waitingIn(me: CurrentUser, scope: Scope, id: string, summaryIds: string[]): Promise<string[]> {
    const ids = [...(await this.repo.placedIn(id, unique(summaryIds)))];
    return scope.own ? this.repo.writtenBy(me.id, ids) : ids;
  }

  /** What is left in the collection (with `own`: of the caller's own). */
  private async leftOf(me: CurrentUser, scope: Scope, id: string): Promise<number> {
    if (scope.own) return this.repo.ownLeft(id, me.id);
    return (await this.repo.leftCounts([id])).get(id) ?? 0;
  }

  /**
   * Where the caller may sort, and what: a collection in the legacy root they manage (all of it), or only the summaries
   * they wrote in the root itself (the unfiled: it has no managers) or in a collection someone else manages. Either
   * way the ids are limited further by `waitingIn` / `writtenBy`, so a collection of others yields nothing but the
   * caller's own summaries.
   */
  private async assertCollection(me: CurrentUser, id: string): Promise<Scope> {
    const place = await this.repo.placeOf(id);
    if (place === 'root') return { rootId: id, own: true };
    if (place !== 'collection') throw new BadRequestException('not a collection from the old Summer');
    const managed = (await this.folderRepo.visibleIds(me, [id], 'edit')).has(id);
    return { rootId: (await this.repo.rootId())!, own: !managed };
  }
}
