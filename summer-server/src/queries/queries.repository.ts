import { Injectable } from '@nestjs/common';
import { SQL, and, asc, desc, eq, ilike, ne, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { QueryKind, queries, queryAlerts, users } from '../database/schema';

export type QueryRow = typeof queries.$inferSelect;
export type AlertRow = typeof queryAlerts.$inferSelect;
export type QueryValues = Pick<QueryRow, 'name' | 'kind' | 'search' | 'isFavorite' | 'isShared'>;
export type AlertValues = Pick<AlertRow, 'isActive' | 'isMail' | 'isDigest'>;

/** A query with its owner, the given user's alert on it (if any), and how many others alert on it. */
export interface QueryWithAlert {
  query: QueryRow;
  alert: AlertRow | null;
  owner: { id: string; username: string; fullName: string };
  followers: number;
}

/** `%`, `_` and `\` typed by the user are literal in ILIKE. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

@Injectable()
export class QueriesRepository {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  /** Queries the user may see: their own, and shared ones. */
  private visible(userId: string): SQL {
    return or(eq(queries.ownerId, userId), eq(queries.isShared, true))!;
  }

  private select(userId: string) {
    return this.db
      .select({
        query: queries,
        alert: queryAlerts,
        owner: { id: users.id, username: users.username, fullName: users.fullName },
        followers: sql<number>`(select count(*)::int from ${queryAlerts} f where f.query_id = ${queries.id} and f.user_id <> ${queries.ownerId})`,
      })
      .from(queries)
      .innerJoin(users, eq(users.id, queries.ownerId))
      .leftJoin(queryAlerts, and(eq(queryAlerts.queryId, queries.id), eq(queryAlerts.userId, userId)));
  }

  /** The user's own queries: favourites first, then newest first. */
  async ownedBy(userId: string): Promise<QueryWithAlert[]> {
    return this.select(userId).where(eq(queries.ownerId, userId)).orderBy(desc(queries.isFavorite), desc(queries.createdAt), asc(queries.id));
  }

  /** Others' shared queries the user alerts on (they follow the original). */
  async followedBy(userId: string): Promise<QueryWithAlert[]> {
    return this.select(userId)
      .where(and(ne(queries.ownerId, userId), eq(queries.isShared, true), sql`${queryAlerts.id} is not null`))
      .orderBy(desc(queryAlerts.createdAt), asc(queries.id));
  }

  /** Others' shared queries (active owners), newest first; `text` narrows by name or owner. */
  async shared(userId: string, text: string, limit: number, offset: number): Promise<QueryWithAlert[]> {
    const like = text ? `%${likeEscape(text)}%` : null;
    return this.select(userId)
      .where(
        and(
          eq(queries.isShared, true),
          ne(queries.ownerId, userId),
          eq(users.isActive, true),
          like ? or(ilike(queries.name, like), ilike(users.fullName, like), ilike(users.username, like)) : undefined,
        ),
      )
      .orderBy(desc(queries.updatedAt), asc(queries.id))
      .limit(limit)
      .offset(offset);
  }

  /** One query the user may see (theirs, or shared). */
  async one(userId: string, id: string): Promise<QueryWithAlert | undefined> {
    const [row] = await this.select(userId).where(and(eq(queries.id, id), this.visible(userId)));
    return row;
  }

  async insert(ownerId: string, values: Omit<QueryValues, 'isShared'> & { isShared?: boolean }): Promise<QueryRow> {
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

  /** A query stopped being shared: only its owner's alert stays. */
  async deleteOthersAlerts(queryId: string, ownerId: string): Promise<void> {
    await this.db.delete(queryAlerts).where(and(eq(queryAlerts.queryId, queryId), ne(queryAlerts.userId, ownerId)));
  }
}
