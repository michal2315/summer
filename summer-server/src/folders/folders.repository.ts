import { Injectable } from '@nestjs/common';
import { SQL, and, asc, eq, inArray, sql } from 'drizzle-orm';
import { CurrentUser } from '../auth/identity-provider';
import { idsWhere } from '../common/sql';
import { DatabaseService } from '../database/database.service';
import { folderEditors, folderPermissions, folderSummaries, folders, summaries } from '../database/schema';
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

  /** Published summaries placed directly in each folder: how many pass `summaryVisible` and how many don't. */
  async itemCounts(folderIds: string[], summaryVisible: SQL): Promise<Map<string, { visible: number; hidden: number }>> {
    const counts = new Map(folderIds.map((id) => [id, { visible: 0, hidden: 0 }]));
    if (!folderIds.length) return counts;
    const rows = await this.db
      .select({
        folderId: folderSummaries.folderId,
        visible: sql<number>`(count(*) filter (where ${summaryVisible}))::int`,
        hidden: sql<number>`(count(*) filter (where not ${summaryVisible}))::int`,
      })
      .from(folderSummaries)
      .innerJoin(summaries, eq(summaries.id, folderSummaries.summaryId))
      .where(and(inArray(folderSummaries.folderId, folderIds), eq(summaries.isDraft, false)))
      .groupBy(folderSummaries.folderId);
    for (const r of rows) counts.set(r.folderId, { visible: r.visible, hidden: r.hidden });
    return counts;
  }

  /** Summaries directly in the folder that the caller may see, sorted by title. */
  items(folderId: string, summaryVisible: SQL) {
    return this.db
      .select({ id: summaries.id, name: summaries.title, kind: summaries.kind })
      .from(folderSummaries)
      .innerJoin(summaries, eq(summaries.id, folderSummaries.summaryId))
      .where(and(eq(folderSummaries.folderId, folderId), eq(summaries.isDraft, false), summaryVisible))
      .orderBy(asc(summaries.title));
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
  async place(folderId: string, summaryIds: string[]): Promise<void> {
    if (summaryIds.length)
      await this.db
        .insert(folderSummaries)
        .values(summaryIds.map((summaryId) => ({ summaryId, folderId })))
        .onConflictDoUpdate({ target: folderSummaries.summaryId, set: { folderId, createdAt: new Date() } });
  }

  /** Take items out of `folderId` (only if they are in it). The items themselves are untouched. */
  async unplace(folderId: string, summaryIds: string[]): Promise<void> {
    if (summaryIds.length)
      await this.db.delete(folderSummaries).where(and(eq(folderSummaries.folderId, folderId), inArray(folderSummaries.summaryId, summaryIds)));
  }

  /** Serializes folder moves for the rest of the transaction, so two concurrent moves cannot form a cycle. */
  async lockMoves(): Promise<void> {
    await this.db.execute(sql`select pg_advisory_xact_lock(hashtext('summer:folder-move'))`);
  }

  /** `folderId` is `ancestorId` or somewhere below it. */
  async isWithin(folderId: string, ancestorId: string): Promise<boolean> {
    const { rows } = await this.db.execute<{ hit: boolean }>(sql`
      with recursive chain(id, parent_id) as (
        select id, parent_id from ${folders} where id = ${folderId}
        union all
        select f.id, f.parent_id from ${folders} f join chain c on f.id = c.parent_id
      )
      select exists (select 1 from chain where id = ${ancestorId}) as hit`);
    return rows[0].hit;
  }

  async setParent(id: string, parentId: string | null): Promise<void> {
    await this.db
      .update(folders)
      .set({ parentId, updatedAt: new Date(), version: sql`${folders.version} + 1` })
      .where(eq(folders.id, id));
  }

  /** Deletes the folder and (FK cascade) its whole subtree and their placements. */
  async delete(id: string): Promise<void> {
    await this.db.delete(folders).where(eq(folders.id, id));
  }
}
