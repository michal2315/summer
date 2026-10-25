import { Injectable } from '@nestjs/common';
import { SQL, and, asc, eq, inArray, sql } from 'drizzle-orm';
import { CurrentUser } from '../auth/identity-provider';
import { collectionEditable } from '../collections/collection.access';
import { idsWhere } from '../common/sql';
import { DatabaseService } from '../database/database.service';
import { collections, folderCollections, folderEditors, folderPermissions, folderSummaries, folders, summaries } from '../database/schema';
import { folderEditable, folderVisible } from './folder.access';

const refColumns = { id: true, username: true, fullName: true, department: true, isSystem: true } as const;

@Injectable()
export class FoldersRepository {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  /** The subset of folder `ids` the caller may view (or edit) — see folder.access.ts. */
  visibleIds(me: CurrentUser, ids: string[], mode: 'view' | 'edit' = 'view'): Promise<Set<string>> {
    return idsWhere(this.db, folders, folders.id, ids, mode === 'view' ? folderVisible(me) : folderEditable(me));
  }

  /** The subset of collection `ids` the caller manages (placing a collection in a folder needs that). */
  editableCollectionIds(me: CurrentUser, ids: string[]): Promise<Set<string>> {
    return idsWhere(this.db, collections, collections.id, ids, collectionEditable(me));
  }

  async ids(where: SQL): Promise<string[]> {
    const rows = await this.db.select({ id: folders.id }).from(folders).where(where).orderBy(asc(folders.name), asc(folders.id));
    return rows.map((r) => r.id);
  }

  async loadFull(ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.db.query.folders.findMany({
      where: (f, { inArray }) => inArray(f.id, ids),
      with: {
        author: { columns: refColumns },
        permissions: { with: { permission: true } },
        editors: { columns: { userId: true } },
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(folders).where(eq(folders.id, id));
    return row;
  }

  async lockForUpdate(id: string): Promise<boolean> {
    const rows = await this.db.select({ id: folders.id }).from(folders).where(eq(folders.id, id)).for('update');
    return rows.length > 0;
  }

  /** Items placed directly in each folder that pass the given visibility predicates (published summaries only). */
  async itemCounts(folderIds: string[], summaryVisible: SQL, collectionVisible: SQL): Promise<Map<string, number>> {
    const counts = new Map<string, number>(folderIds.map((id) => [id, 0]));
    if (!folderIds.length) return counts;
    const [s, c] = await Promise.all([
      this.db
        .select({ folderId: folderSummaries.folderId, n: sql<number>`count(*)::int` })
        .from(folderSummaries)
        .innerJoin(summaries, eq(summaries.id, folderSummaries.summaryId))
        .where(and(inArray(folderSummaries.folderId, folderIds), eq(summaries.isDraft, false), summaryVisible))
        .groupBy(folderSummaries.folderId),
      this.db
        .select({ folderId: folderCollections.folderId, n: sql<number>`count(*)::int` })
        .from(folderCollections)
        .innerJoin(collections, eq(collections.id, folderCollections.collectionId))
        .where(and(inArray(folderCollections.folderId, folderIds), collectionVisible))
        .groupBy(folderCollections.folderId),
    ]);
    for (const r of [...s, ...c]) counts.set(r.folderId, (counts.get(r.folderId) ?? 0) + r.n);
    return counts;
  }

  /** Collections then summaries directly in the folder, each filtered by its own visibility and sorted by name. */
  async items(folderId: string, summaryVisible: SQL, collectionVisible: SQL) {
    const [cols, sums] = await Promise.all([
      this.db
        .select({ id: collections.id, name: collections.name })
        .from(folderCollections)
        .innerJoin(collections, eq(collections.id, folderCollections.collectionId))
        .where(and(eq(folderCollections.folderId, folderId), collectionVisible))
        .orderBy(asc(collections.name)),
      this.db
        .select({ id: summaries.id, name: summaries.title, kind: summaries.kind })
        .from(folderSummaries)
        .innerJoin(summaries, eq(summaries.id, folderSummaries.summaryId))
        .where(and(eq(folderSummaries.folderId, folderId), eq(summaries.isDraft, false), summaryVisible))
        .orderBy(asc(summaries.title)),
    ]);
    return { collections: cols, summaries: sums };
  }

  async insert(values: { name: string; parentId: string | null; createdBy: string }): Promise<string> {
    const [row] = await this.db.insert(folders).values(values).returning({ id: folders.id });
    return row.id;
  }

  async update(id: string, values: { name: string }): Promise<void> {
    await this.db
      .update(folders)
      .set({ ...values, updatedAt: new Date(), version: sql`${folders.version} + 1` })
      .where(eq(folders.id, id));
  }

  async touch(id: string): Promise<void> {
    await this.db.update(folders).set({ updatedAt: new Date() }).where(eq(folders.id, id));
  }

  async replacePermissions(id: string, permissionIds: string[]): Promise<void> {
    await this.db.delete(folderPermissions).where(eq(folderPermissions.folderId, id));
    await this.db.insert(folderPermissions).values(permissionIds.map((permissionId) => ({ folderId: id, permissionId })));
  }

  async replaceEditors(id: string, userIds: string[]): Promise<void> {
    await this.db.delete(folderEditors).where(eq(folderEditors.folderId, id));
    await this.db.insert(folderEditors).values(userIds.map((userId) => ({ folderId: id, userId })));
  }

  /** Place items in `folderId`, moving them out of any folder that held them (one folder per item). */
  async place(folderId: string, summaryIds: string[], collectionIds: string[]): Promise<void> {
    const now = new Date();
    if (summaryIds.length)
      await this.db
        .insert(folderSummaries)
        .values(summaryIds.map((summaryId) => ({ summaryId, folderId })))
        .onConflictDoUpdate({ target: folderSummaries.summaryId, set: { folderId, createdAt: now } });
    if (collectionIds.length)
      await this.db
        .insert(folderCollections)
        .values(collectionIds.map((collectionId) => ({ collectionId, folderId })))
        .onConflictDoUpdate({ target: folderCollections.collectionId, set: { folderId, createdAt: now } });
  }

  /** Take items out of `folderId` (only if they are in it). The items themselves are untouched. */
  async unplace(folderId: string, summaryIds: string[], collectionIds: string[]): Promise<void> {
    if (summaryIds.length)
      await this.db.delete(folderSummaries).where(and(eq(folderSummaries.folderId, folderId), inArray(folderSummaries.summaryId, summaryIds)));
    if (collectionIds.length)
      await this.db
        .delete(folderCollections)
        .where(and(eq(folderCollections.folderId, folderId), inArray(folderCollections.collectionId, collectionIds)));
  }

  /** Deletes the folder and (FK cascade) its whole subtree and their placements. */
  async delete(id: string): Promise<void> {
    await this.db.delete(folders).where(eq(folders.id, id));
  }
}
