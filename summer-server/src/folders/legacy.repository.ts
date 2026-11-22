import { Injectable } from '@nestjs/common';
import { SQL, and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { CurrentUser } from '../auth/identity-provider';
import { DatabaseService } from '../database/database.service';
import { folderEditors, folderSummaries, folders, legacyCollections, legacyReleases, permissions, summaries, summaryPermissions } from '../database/schema';
import { folderEditable } from './folder.access';

/** Where a folder sits relative to the legacy root: the root itself, a collection directly in it, or neither. */
export type LegacyPlace = 'root' | 'collection' | null;

@Injectable()
export class LegacyRepository {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  async rootId(): Promise<string | null> {
    const [row] = await this.db.select({ id: folders.id }).from(folders).where(eq(folders.isLegacyRoot, true));
    return row?.id ?? null;
  }

  /** The legacy root, created on first use (by the import, or the seed). It has no permissions and no managers. */
  async ensureRoot(createdBy: string, name = 'לקטים מ-Summer הישן'): Promise<string> {
    const existing = await this.rootId();
    if (existing) return existing;
    await this.db.insert(folders).values({ name, parentId: null, createdBy, isLegacyRoot: true }).onConflictDoNothing();
    return (await this.rootId())!;
  }

  async placeOf(id: string): Promise<LegacyPlace> {
    const parent = alias(folders, 'parent');
    const [row] = await this.db
      .select({ isRoot: folders.isLegacyRoot, parentIsRoot: parent.isLegacyRoot })
      .from(folders)
      .leftJoin(parent, eq(parent.id, folders.parentId))
      .where(eq(folders.id, id));
    return row?.isRoot ? 'root' : row?.parentIsRoot ? 'collection' : null;
  }

  /** Collections in the legacy root that the caller manages, by name. */
  async editableCollections(me: CurrentUser, rootId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.parentId, rootId), folderEditable(me)))
      .orderBy(folders.name, folders.id);
    return rows.map((r) => r.id);
  }

  /**
   * Register every collection in the legacy root that has no progress row yet, with its current placements as the
   * total (the import should register them as it creates them; this catches any it didn't).
   */
  async register(rootId: string): Promise<void> {
    await this.db.execute(sql`
      insert into ${legacyCollections} (folder_id, name, total)
      select f.id, f.name, (select count(*)::int from ${folderSummaries} fs join ${summaries} s on s.id = fs.summary_id
                            where fs.folder_id = f.id and s.is_draft = false)
      from ${folders} f where f.parent_id = ${rootId}
      on conflict (folder_id) do nothing`);
  }

  /**
   * The progress bar's total: placements of every registered collection the caller manages, wherever it is now (still
   * in the legacy root, moved out, or deleted; a deleted one by the managers copied when it was deleted). Also how many
   * such collections there are and how many have left the legacy root.
   */
  async progress(me: CurrentUser, rootId: string): Promise<{ total: number; collections: number; done: number }> {
    const [row] = await this.db
      .select({
        total: sql<number>`coalesce(sum(${legacyCollections.total}), 0)::int`,
        collections: sql<number>`count(*)::int`,
        done: sql<number>`(count(*) filter (where ${folders.id} is null or ${folders.parentId} is distinct from ${rootId}))::int`,
      })
      .from(legacyCollections)
      .leftJoin(folders, eq(folders.id, legacyCollections.folderId))
      .where(sql`(${folders.id} is not null and ${folderEditable(me)}) or (${folders.id} is null and ${me.id} = any(${legacyCollections.managers}))`);
    return row;
  }

  /** Published placements still in each collection (seen by the caller or not): what is left to sort. */
  async leftCounts(ids: string[]): Promise<Map<string, number>> {
    const counts = new Map(ids.map((id) => [id, 0]));
    if (!ids.length) return counts;
    const rows = await this.db
      .select({ folderId: folderSummaries.folderId, n: sql<number>`count(*)::int` })
      .from(folderSummaries)
      .innerJoin(summaries, eq(summaries.id, folderSummaries.summaryId))
      .where(and(inArray(folderSummaries.folderId, ids), eq(summaries.isDraft, false)))
      .groupBy(folderSummaries.folderId);
    for (const r of rows) counts.set(r.folderId, r.n);
    return counts;
  }

  async totals(ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await this.db
      .select({ id: legacyCollections.folderId, total: legacyCollections.total })
      .from(legacyCollections)
      .where(inArray(legacyCollections.folderId, ids));
    return new Map(rows.map((r) => [r.id, r.total]));
  }

  /**
   * The other folders each summary is in (besides `exceptId`) that pass `folderVisible`, with whether each is in the
   * legacy root (a collection, or the root itself): the staging page's "already moved to …" and "also waiting in …".
   */
  async otherFolders(summaryIds: string[], exceptId: string, folderVisible: SQL, rootId: string) {
    if (!summaryIds.length) return [];
    return this.db
      .select({
        summaryId: folderSummaries.summaryId,
        id: folders.id,
        name: folders.name,
        legacy: sql<boolean>`(${folders.parentId} is not distinct from ${rootId} or ${folders.isLegacyRoot})`,
      })
      .from(folderSummaries)
      .innerJoin(folders, eq(folders.id, folderSummaries.folderId))
      .where(and(inArray(folderSummaries.summaryId, summaryIds), ne(folderSummaries.folderId, exceptId), folderVisible))
      .orderBy(folders.name);
  }

  /** Which of `folderIds` each of `summaryIds` is placed in, with the summary's author. */
  async placements(folderIds: string[], summaryIds: string[]): Promise<{ folderId: string; summaryId: string; createdBy: string }[]> {
    if (!folderIds.length || !summaryIds.length) return [];
    return this.db
      .select({ folderId: folderSummaries.folderId, summaryId: folderSummaries.summaryId, createdBy: summaries.createdBy })
      .from(folderSummaries)
      .innerJoin(summaries, eq(summaries.id, folderSummaries.summaryId))
      .where(and(inArray(folderSummaries.folderId, folderIds), inArray(folderSummaries.summaryId, summaryIds)));
  }

  /**
   * The caller's own summaries waiting directly in the legacy root (the old Summer had them in no collection): how
   * many are left, and how many were sorted out of it already (their release rows).
   */
  async unfiledCounts(rootId: string, userId: string): Promise<{ left: number; released: number }> {
    const [left] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(folderSummaries)
      .innerJoin(summaries, eq(summaries.id, folderSummaries.summaryId))
      .where(and(eq(folderSummaries.folderId, rootId), eq(summaries.createdBy, userId), eq(summaries.isDraft, false)));
    const [released] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(legacyReleases)
      .innerJoin(summaries, eq(summaries.id, legacyReleases.summaryId))
      .where(and(eq(legacyReleases.folderId, rootId), eq(summaries.createdBy, userId), eq(summaries.isDraft, false)));
    return { left: left.n, released: released.n };
  }

  /** The caller's own published summaries still placed in `folderId`. */
  async ownLeft(folderId: string, userId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(folderSummaries)
      .innerJoin(summaries, eq(summaries.id, folderSummaries.summaryId))
      .where(and(eq(folderSummaries.folderId, folderId), eq(summaries.createdBy, userId), eq(summaries.isDraft, false)));
    return row.n;
  }

  /**
   * Collections in the legacy root the caller does not manage, with how many of the caller's own published summaries
   * wait in each (`left`) and were sorted out of each already (`released`). Only collections with either.
   */
  async authoredCollections(me: CurrentUser, rootId: string): Promise<{ id: string; left: number; released: number }[]> {
    const own = (table: typeof folderSummaries | typeof legacyReleases) => sql<number>`(
      select count(*)::int from ${table} x join ${summaries} s on s.id = x.summary_id
      where x.folder_id = "folders"."id" and s.created_by = ${me.id} and s.is_draft = false)`;
    const rows = await this.db
      .select({ id: folders.id, left: own(folderSummaries), released: own(legacyReleases) })
      .from(folders)
      .where(and(eq(folders.parentId, rootId), sql`not ${folderEditable(me)}`))
      .orderBy(folders.name, folders.id);
    return rows.filter((r) => r.left || r.released);
  }

  /** The caller's own published summaries taken out of each of `folderIds` (their release rows), by name. */
  async ownReleased(folderIds: string[], userId: string) {
    if (!folderIds.length) return [];
    return this.db
      .select({ folderId: legacyReleases.folderId, summaryId: summaries.id, name: summaries.title, kind: summaries.kind })
      .from(legacyReleases)
      .innerJoin(summaries, eq(summaries.id, legacyReleases.summaryId))
      .where(and(inArray(legacyReleases.folderId, folderIds), eq(summaries.createdBy, userId), eq(summaries.isDraft, false)))
      .orderBy(summaries.title);
  }

  /** Each summary's own permissions (viewing needs all of them). */
  async summaryPermissions(summaryIds: string[]) {
    if (!summaryIds.length) return [];
    return this.db
      .select({ summaryId: summaryPermissions.summaryId, id: permissions.id, name: permissions.name, groupName: permissions.groupName, color: permissions.color })
      .from(summaryPermissions)
      .innerJoin(permissions, eq(permissions.id, summaryPermissions.permissionId))
      .where(inArray(summaryPermissions.summaryId, summaryIds));
  }

  /** Of `summaryIds`, the ones `userId` wrote. */
  async writtenBy(userId: string, summaryIds: string[]): Promise<string[]> {
    if (!summaryIds.length) return [];
    const rows = await this.db
      .select({ id: summaries.id })
      .from(summaries)
      .where(and(inArray(summaries.id, summaryIds), eq(summaries.createdBy, userId)));
    const mine = new Set(rows.map((r) => r.id));
    return summaryIds.filter((id) => mine.has(id));
  }

  /** Of `summaryIds`, the ones placed in `folderId`. */
  async placedIn(folderId: string, summaryIds: string[]): Promise<Set<string>> {
    if (!summaryIds.length) return new Set();
    const rows = await this.db
      .select({ id: folderSummaries.summaryId })
      .from(folderSummaries)
      .where(and(eq(folderSummaries.folderId, folderId), inArray(folderSummaries.summaryId, summaryIds)));
    return new Set(rows.map((r) => r.id));
  }

  /** Take the summaries out of the collection and remember it, so it can be undone. */
  async release(folderId: string, summaryIds: string[]): Promise<void> {
    if (!summaryIds.length) return;
    await this.db.delete(folderSummaries).where(and(eq(folderSummaries.folderId, folderId), inArray(folderSummaries.summaryId, summaryIds)));
    await this.db
      .insert(legacyReleases)
      .values(summaryIds.map((summaryId) => ({ folderId, summaryId })))
      .onConflictDoUpdate({ target: [legacyReleases.folderId, legacyReleases.summaryId], set: { createdAt: new Date() } });
  }

  /** Put released summaries back (undo). Only ones taken out of this collection before; returns those. */
  async restore(folderId: string, summaryIds: string[]): Promise<string[]> {
    if (!summaryIds.length) return [];
    const rows = await this.db
      .delete(legacyReleases)
      .where(and(eq(legacyReleases.folderId, folderId), inArray(legacyReleases.summaryId, summaryIds)))
      .returning({ id: legacyReleases.summaryId });
    const ids = rows.map((r) => r.id);
    if (ids.length)
      await this.db
        .insert(folderSummaries)
        .values(ids.map((summaryId) => ({ folderId, summaryId })))
        .onConflictDoNothing();
    return ids;
  }

  /** The collection's progress row, unless it was deleted. */
  async collection(folderId: string) {
    const [row] = await this.db
      .select()
      .from(legacyCollections)
      .where(and(eq(legacyCollections.folderId, folderId), isNull(legacyCollections.deletedAt)));
    return row;
  }

  async hasSubfolders(id: string): Promise<boolean> {
    const [row] = await this.db.select({ id: folders.id }).from(folders).where(eq(folders.parentId, id)).limit(1);
    return !!row;
  }

  /**
   * Before folders are deleted: keep the progress rows of the legacy collections among them (or under them), with
   * their managers, so the progress bar still counts them as sorted.
   */
  async keepOnDelete(id: string): Promise<void> {
    await this.db.execute(sql`
      with recursive sub(id) as (
        select ${id}::uuid
        union all
        select f.id from ${folders} f join sub on f.parent_id = sub.id
      )
      update ${legacyCollections} lc
      set deleted_at = now(),
          managers = coalesce((select array_agg(fe.user_id) from ${folderEditors} fe where fe.folder_id = lc.folder_id), '{}'::uuid[])
      where lc.folder_id in (select id from sub) and lc.deleted_at is null`);
  }
}
