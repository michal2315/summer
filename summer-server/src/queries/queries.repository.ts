import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { QueryKind, queries, queryAlerts } from '../database/schema';

export type QueryRow = typeof queries.$inferSelect;
export type AlertRow = typeof queryAlerts.$inferSelect;
export type QueryValues = Pick<QueryRow, 'name' | 'kind' | 'search' | 'isFavorite'>;
export type AlertValues = Pick<AlertRow, 'isActive' | 'isMail' | 'isDigest'>;

/** A query with the given user's alert on it, if any. */
export interface QueryWithAlert {
  query: QueryRow;
  alert: AlertRow | null;
}

@Injectable()
export class QueriesRepository {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  /** The owner's queries with their own alerts: favourites first, then newest first. */
  async ownedBy(userId: string): Promise<QueryWithAlert[]> {
    const rows = await this.db
      .select({ query: queries, alert: queryAlerts })
      .from(queries)
      .leftJoin(queryAlerts, and(eq(queryAlerts.queryId, queries.id), eq(queryAlerts.userId, userId)))
      .where(eq(queries.ownerId, userId))
      .orderBy(desc(queries.isFavorite), desc(queries.createdAt), asc(queries.id));
    return rows;
  }

  async one(userId: string, id: string): Promise<QueryWithAlert | undefined> {
    const [row] = await this.db
      .select({ query: queries, alert: queryAlerts })
      .from(queries)
      .leftJoin(queryAlerts, and(eq(queryAlerts.queryId, queries.id), eq(queryAlerts.userId, userId)))
      .where(and(eq(queries.id, id), eq(queries.ownerId, userId)));
    return row;
  }

  async insert(ownerId: string, values: QueryValues): Promise<QueryRow> {
    const [row] = await this.db.insert(queries).values({ ownerId, ...values }).returning();
    return row;
  }

  async update(ownerId: string, id: string, patch: Partial<QueryValues & { kind: QueryKind }>): Promise<boolean> {
    const rows = await this.db
      .update(queries)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(queries.id, id), eq(queries.ownerId, ownerId)))
      .returning({ id: queries.id });
    return rows.length > 0;
  }

  async delete(ownerId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(queries)
      .where(and(eq(queries.id, id), eq(queries.ownerId, ownerId)))
      .returning({ id: queries.id });
    return rows.length > 0;
  }

  /** Create or change the user's alert on the query. */
  async upsertAlert(queryId: string, userId: string, values: Partial<AlertValues>): Promise<void> {
    await this.db
      .insert(queryAlerts)
      .values({ queryId, userId, ...values })
      .onConflictDoUpdate({ target: [queryAlerts.queryId, queryAlerts.userId], set: { ...values, updatedAt: new Date() } });
  }

  async deleteAlert(queryId: string, userId: string): Promise<void> {
    await this.db.delete(queryAlerts).where(and(eq(queryAlerts.queryId, queryId), eq(queryAlerts.userId, userId)));
  }
}
