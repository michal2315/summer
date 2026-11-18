import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/identity-provider';
import { ApiBulkResult } from '../common/api-types';
import { parse, unique, zId } from '../common/validation';
import { DatabaseService } from '../database/database.service';
import { SummariesRepository } from '../summaries/summaries.repository';
import { SummariesService } from '../summaries/summaries.service';
import { folderVisible } from './folder.access';
import { ApiFolder, ApiFolderItem, FoldersService } from './folders.service';
import { FoldersRepository } from './folders.repository';
import { LegacyRepository } from './legacy.repository';

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
  /** Over every collection the caller manages or managed (including ones already moved out or deleted), and the unfiled. */
  progress: { total: number; left: number; collections: number; done: number };
}

/** Where staging acts: a collection, or the legacy root itself for the caller's unfiled summaries. */
interface Scope {
  rootId: string;
  unfiled: boolean;
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
 * are flat folders in the legacy root; their managers sort them, for everyone. Summaries and whole collections only
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
  ) {}

  async overview(me: CurrentUser): Promise<ApiLegacyOverview> {
    const rootId = await this.repo.rootId();
    if (!rootId) return { rootId: null, collections: [], unfiled: null, progress: { total: 0, left: 0, collections: 0, done: 0 } };
    await this.repo.register(rootId);
    const ids = await this.repo.editableCollections(me, rootId);
    const [hydrated, left, totals, progress, unfiled] = await Promise.all([
      this.folders.hydrate(me, [...ids, rootId]),
      this.repo.leftCounts(ids),
      this.repo.totals(ids),
      this.repo.progress(me, rootId),
      this.repo.unfiledCounts(rootId, me.id),
    ]);
    const root = hydrated.find((f) => f._id === rootId);
    const collections = hydrated
      .filter((f) => f._id !== rootId)
      .map((folder) => ({
        folder,
        left: left.get(folder._id) ?? 0,
        total: Math.max(totals.get(folder._id) ?? 0, left.get(folder._id) ?? 0),
      }));
    // Only the caller's own summaries count, so none of the root's are hidden from them here.
    const unfiledTotal = unfiled.left + unfiled.released;
    const leftAll = collections.reduce((n, c) => n + c.left, 0);
    return {
      rootId,
      collections,
      unfiled: root && unfiled.left ? { folder: { ...root, name: UNFILED_NAME, hiddenCount: 0 }, left: unfiled.left, total: unfiledTotal } : null,
      progress: { ...progress, total: Math.max(progress.total, leftAll) + unfiledTotal, left: leftAll + unfiled.left },
    };
  }

  async items(me: CurrentUser, id: string): Promise<ApiLegacyItem[]> {
    const { rootId, unfiled } = await this.assertCollection(me, id);
    const visible = await this.folderRepo.items(id, this.summaries.visible(me));
    const rows = unfiled ? visible.filter((r) => r.createdBy === me.id) : visible;
    const others = await this.repo.otherFolders(
      rows.map((r) => r.id),
      id,
      folderVisible(me),
      rootId,
    );
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
    const ids = await this.repo.editableCollections(me, rootId);
    const { left: unfiledLeft } = await this.repo.unfiledCounts(rootId, me.id);
    if (!ids.length && !unfiledLeft) return { matches: {}, capped: false };
    // Within the collections (or, for the caller's unfiled ones, the whole root), published only; sumaroons are never
    // placed in a folder themselves (they go with their running summary).
    const f = this.summarySearch.parseSearch({
      ...search,
      folders: unfiledLeft ? [rootId] : ids,
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
    const scope = unfiledLeft ? [...ids, rootId] : ids;
    for (const p of await this.repo.placements(scope, found.slice(0, SEARCH_CAP)))
      if (p.folderId !== rootId || p.createdBy === me.id) (matches[p.folderId] ??= []).push(p.summaryId);
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
      const ids = scope.unfiled ? await this.repo.writtenBy(me.id, unique(summaryIds)) : unique(summaryIds);
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

  /** Of `summaryIds`, the ones waiting in the collection (in the unfiled: and written by the caller). */
  private async waitingIn(me: CurrentUser, scope: Scope, id: string, summaryIds: string[]): Promise<string[]> {
    const ids = [...(await this.repo.placedIn(id, unique(summaryIds)))];
    return scope.unfiled ? this.repo.writtenBy(me.id, ids) : ids;
  }

  /** What is left in the collection (in the unfiled: of the caller's own). */
  private async leftOf(me: CurrentUser, scope: Scope, id: string): Promise<number> {
    if (scope.unfiled) return (await this.repo.unfiledCounts(id, me.id)).left;
    return (await this.repo.leftCounts([id])).get(id) ?? 0;
  }

  /**
   * The folder is a collection in the legacy root that the caller manages, or the root itself (`unfiled`: there each
   * person sorts only the summaries they wrote, since the root has no managers).
   */
  private async assertCollection(me: CurrentUser, id: string): Promise<Scope> {
    const place = await this.repo.placeOf(id);
    if (place === 'root') return { rootId: id, unfiled: true };
    await this.folders.assertEditable(me, id);
    if (place !== 'collection') throw new BadRequestException('not a collection from the old Summer');
    return { rootId: (await this.repo.rootId())!, unfiled: false };
  }
}
