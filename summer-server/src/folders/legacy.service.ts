import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/identity-provider';
import { ApiBulkResult } from '../common/api-types';
import { parse, unique, zId } from '../common/validation';
import { DatabaseService } from '../database/database.service';
import { SummariesRepository } from '../summaries/summaries.repository';
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
  /** Over every collection the caller manages or managed, including ones already moved out or deleted. */
  progress: { total: number; left: number; collections: number; done: number };
}

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
  ) {}

  async overview(me: CurrentUser): Promise<ApiLegacyOverview> {
    const rootId = await this.repo.rootId();
    if (!rootId) return { rootId: null, collections: [], progress: { total: 0, left: 0, collections: 0, done: 0 } };
    await this.repo.register(rootId);
    const ids = await this.repo.editableCollections(me, rootId);
    const [hydrated, left, totals, progress] = await Promise.all([
      this.folders.hydrate(me, ids),
      this.repo.leftCounts(ids),
      this.repo.totals(ids),
      this.repo.progress(me, rootId),
    ]);
    const collections = hydrated.map((folder) => ({
      folder,
      left: left.get(folder._id) ?? 0,
      total: Math.max(totals.get(folder._id) ?? 0, left.get(folder._id) ?? 0),
    }));
    const leftAll = collections.reduce((n, c) => n + c.left, 0);
    return { rootId, collections, progress: { ...progress, total: Math.max(progress.total, leftAll), left: leftAll } };
  }

  async items(me: CurrentUser, id: string): Promise<ApiLegacyItem[]> {
    const rootId = await this.assertCollection(me, id);
    const rows = await this.folderRepo.items(id, this.summaries.visible(me));
    const others = await this.repo.otherFolders(
      rows.map((r) => r.id),
      id,
      folderVisible(me),
      rootId,
    );
    return rows.map((s) => {
      const mine = others.filter((o) => o.summaryId === s.id);
      return {
        _id: s.id,
        name: s.name,
        kind: s.kind,
        mine: s.createdBy === me.id,
        alsoIn: mine.filter((o) => !o.legacy).map((o) => ({ _id: o.id, name: o.name })),
        alsoLegacy: mine.filter((o) => o.legacy).map((o) => ({ _id: o.id, name: o.name })),
      };
    });
  }

  /** Move summaries from the collection into `to` (a folder outside the legacy root the caller manages). */
  async moveItems(me: CurrentUser, id: string, body: unknown): Promise<ApiLegacyMoveResult> {
    const input = parse(moveSchema, body);
    await this.assertCollection(me, id);
    if (input.to === id) throw new BadRequestException('pick another folder');
    return this.database.transaction(async () => {
      const inCollection = await this.repo.placedIn(id, unique(input.summaryIds));
      const ids = [...inCollection];
      if (!ids.length) return { applied: [], skipped: [], added: [], left: await this.leftOf(id) };
      const before = await this.repo.placedIn(input.to, ids);
      // Checks the target (managed, not legacy) and each summary, and places the placeable ones.
      const result = await this.folders.addItems(me, input.to, { summaryIds: ids, partial: true });
      await this.repo.release(id, result.applied);
      await this.folderRepo.touch(id);
      return { ...result, added: result.applied.filter((s) => !before.has(s)), left: await this.leftOf(id) };
    });
  }

  /** Take summaries out of the collection without placing them anywhere (already sorted, or need no folder). */
  async releaseItems(me: CurrentUser, id: string, body: unknown): Promise<{ applied: string[]; left: number }> {
    const { summaryIds } = parse(idsSchema, body);
    await this.assertCollection(me, id);
    return this.database.transaction(async () => {
      const ids = [...(await this.repo.placedIn(id, unique(summaryIds)))];
      await this.repo.release(id, ids);
      await this.folderRepo.touch(id);
      return { applied: ids, left: await this.leftOf(id) };
    });
  }

  /** Undo: put summaries taken out of the collection back in. */
  async restoreItems(me: CurrentUser, id: string, body: unknown): Promise<{ applied: string[]; left: number }> {
    const { summaryIds } = parse(idsSchema, body);
    await this.assertCollection(me, id);
    return this.database.transaction(async () => {
      const applied = await this.repo.restore(id, unique(summaryIds));
      return { applied, left: await this.leftOf(id) };
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

  private async leftOf(id: string): Promise<number> {
    return (await this.repo.leftCounts([id])).get(id) ?? 0;
  }

  /** The folder is a collection in the legacy root and the caller manages it; returns the root's id. */
  private async assertCollection(me: CurrentUser, id: string): Promise<string> {
    await this.folders.assertEditable(me, id);
    if ((await this.repo.placeOf(id)) !== 'collection') throw new BadRequestException('not a collection from the old Summer');
    return (await this.repo.rootId())!;
  }
}
