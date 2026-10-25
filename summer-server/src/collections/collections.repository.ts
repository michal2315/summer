import { Injectable } from '@nestjs/common';
import { SQL, and, asc, desc, eq, exists, ilike, inArray, sql } from 'drizzle-orm';
import { CurrentUser } from '../auth/identity-provider';
import { idsWhere, likePattern } from '../common/sql';
import { DatabaseService } from '../database/database.service';
import {
  collectionEditors,
  collectionPermissions,
  collections,
  summaries,
  summaryCollections,
  userFavCollections,
  userPinnedCollections,
} from '../database/schema';
import { collectionEditable, collectionVisible } from './collection.access';

const refColumns = { id: true, username: true, fullName: true, department: true, isSystem: true } as const;
export const COLLECTION_PAGE = 20;

@Injectable()
export class CollectionsRepository {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  /** The subset of `ids` the caller may view (or edit) — see collection.access.ts. */
  visibleIds(me: CurrentUser, ids: string[], mode: 'view' | 'edit' = 'view'): Promise<Set<string>> {
    return idsWhere(this.db, collections, collections.id, ids, mode === 'view' ? collectionVisible(me) : collectionEditable(me));
  }

  /** One page of visible collections; `prioritizeFor` puts that user's pinned, then favourite collections first. */
  async listIds(opts: { visible: SQL; text: string; managedBy?: string; prioritizeFor?: string; skip: number }): Promise<string[]> {
    const conds: SQL[] = [opts.visible];
    if (opts.text) conds.push(ilike(collections.name, likePattern(opts.text)));
    if (opts.managedBy)
      conds.push(
        exists(
          this.db
            .select({ x: sql`1` })
            .from(collectionEditors)
            .where(and(eq(collectionEditors.collectionId, collections.id), eq(collectionEditors.userId, opts.managedBy))),
        ),
      );
    const order: SQL[] = [];
    if (opts.prioritizeFor) {
      const pinned = exists(
        this.db
          .select({ x: sql`1` })
          .from(userPinnedCollections)
          .where(and(eq(userPinnedCollections.collectionId, collections.id), eq(userPinnedCollections.userId, opts.prioritizeFor))),
      );
      const favorite = exists(
        this.db
          .select({ x: sql`1` })
          .from(userFavCollections)
          .where(and(eq(userFavCollections.collectionId, collections.id), eq(userFavCollections.userId, opts.prioritizeFor))),
      );
      order.push(sql`case when ${pinned} then 0 when ${favorite} then 1 else 2 end`);
    }
    const rows = await this.db
      .select({ id: collections.id })
      .from(collections)
      .where(and(...conds))
      .orderBy(...order, desc(collections.updatedAt), desc(collections.id))
      .offset(opts.skip)
      .limit(COLLECTION_PAGE);
    return rows.map((r) => r.id);
  }

  async refs(where: SQL, limit = COLLECTION_PAGE): Promise<{ id: string; name: string }[]> {
    return this.db.select({ id: collections.id, name: collections.name }).from(collections).where(where).orderBy(asc(collections.name)).limit(limit);
  }

  byNameCondition(text: string): SQL | undefined {
    return text ? ilike(collections.name, likePattern(text)) : undefined;
  }

  byIdsCondition(ids: string[]): SQL {
    return inArray(collections.id, ids);
  }

  async loadFull(ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.db.query.collections.findMany({
      where: (c, { inArray }) => inArray(c.id, ids),
      with: {
        author: { columns: refColumns },
        permissions: { with: { permission: true } },
        editors: { columns: { userId: true } },
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  }

  /** collection id → ids of its published summaries that pass `summaryVisible`. */
  async visibleSummaryIds(collectionIds: string[], summaryVisible: SQL): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>(collectionIds.map((id) => [id, []]));
    if (!collectionIds.length) return result;
    const rows = await this.db
      .select({ collectionId: summaryCollections.collectionId, summaryId: summaries.id })
      .from(summaryCollections)
      .innerJoin(summaries, eq(summaries.id, summaryCollections.summaryId))
      .where(and(inArray(summaryCollections.collectionId, collectionIds), eq(summaries.isDraft, false), summaryVisible))
      .orderBy(desc(summaries.createdAt));
    for (const r of rows) result.get(r.collectionId)!.push(r.summaryId);
    return result;
  }

  async lockForUpdate(id: string): Promise<boolean> {
    const rows = await this.db.select({ id: collections.id }).from(collections).where(eq(collections.id, id)).for('update');
    return rows.length > 0;
  }

  async insert(name: string, createdBy: string): Promise<string> {
    const [row] = await this.db.insert(collections).values({ name, createdBy }).returning({ id: collections.id });
    return row.id;
  }

  async update(id: string, values: { name?: string }): Promise<void> {
    await this.db
      .update(collections)
      .set({ ...values, updatedAt: new Date(), version: sql`${collections.version} + 1` })
      .where(eq(collections.id, id));
  }

  async touch(ids: string[]): Promise<void> {
    if (ids.length) await this.db.update(collections).set({ updatedAt: new Date() }).where(inArray(collections.id, ids));
  }

  async replacePermissions(id: string, permissionIds: string[]): Promise<void> {
    await this.db.delete(collectionPermissions).where(eq(collectionPermissions.collectionId, id));
    await this.db.insert(collectionPermissions).values(permissionIds.map((permissionId) => ({ collectionId: id, permissionId })));
  }

  async replaceEditors(id: string, userIds: string[]): Promise<void> {
    await this.db.delete(collectionEditors).where(eq(collectionEditors.collectionId, id));
    await this.db.insert(collectionEditors).values(userIds.map((userId) => ({ collectionId: id, userId })));
  }

  async addMemberships(pairs: { summaryId: string; collectionId: string }[]): Promise<void> {
    if (pairs.length) await this.db.insert(summaryCollections).values(pairs).onConflictDoNothing();
  }

  /** Removes memberships only; the shared summaries are untouched. */
  async removeMemberships(collectionId: string, summaryIds: string[]): Promise<void> {
    if (summaryIds.length)
      await this.db.delete(summaryCollections).where(and(eq(summaryCollections.collectionId, collectionId), inArray(summaryCollections.summaryId, summaryIds)));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(collections).where(eq(collections.id, id));
  }
}

export type FullCollection = Awaited<ReturnType<CollectionsRepository['loadFull']>>[number];
