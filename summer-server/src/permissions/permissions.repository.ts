import { Injectable } from '@nestjs/common';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { collectionPermissions, permissions, summaryPermissions } from '../database/schema';

export type PermissionRow = typeof permissions.$inferSelect;

const GROUP_MAP_TTL_MS = 30_000;

@Injectable()
export class PermissionsRepository {
  private groupMap: { at: number; byKey: Map<string, string> } | null = null;

  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  list(): Promise<PermissionRow[]> {
    return this.db.select().from(permissions).orderBy(asc(permissions.name));
  }

  byIds(ids: string[]): Promise<PermissionRow[]> {
    if (!ids.length) return Promise.resolve([]);
    return this.db.select().from(permissions).where(inArray(permissions.id, ids));
  }

  byGroupNames(keys: string[]): Promise<PermissionRow[]> {
    if (!keys.length) return Promise.resolve([]);
    return this.db.select().from(permissions).where(inArray(permissions.groupName, keys)).orderBy(asc(permissions.name));
  }

  /** External group keys → Summer permission ids. Unknown keys are ignored (they grant nothing). Cached briefly. */
  async idsForGroupKeys(keys: string[]): Promise<string[]> {
    if (!this.groupMap || Date.now() - this.groupMap.at > GROUP_MAP_TTL_MS) {
      const rows = await this.db.select({ id: permissions.id, groupName: permissions.groupName }).from(permissions);
      this.groupMap = { at: Date.now(), byKey: new Map(rows.map((r) => [r.groupName, r.id])) };
    }
    const map = this.groupMap.byKey;
    return keys.flatMap((k) => (map.has(k) ? [map.get(k)!] : []));
  }

  async insert(values: { name: string; groupName: string; color: string }): Promise<PermissionRow> {
    const [row] = await this.db.insert(permissions).values(values).returning();
    this.groupMap = null;
    return row;
  }

  async update(id: string, values: { name: string; groupName: string; color: string }): Promise<PermissionRow | undefined> {
    const [row] = await this.db
      .update(permissions)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(permissions.id, id))
      .returning();
    this.groupMap = null;
    return row;
  }

  async isReferenced(id: string): Promise<boolean> {
    const [row] = await this.db.execute<{ used: boolean }>(sql`
      select exists (select 1 from ${summaryPermissions} where ${summaryPermissions.permissionId} = ${id})
          or exists (select 1 from ${collectionPermissions} where ${collectionPermissions.permissionId} = ${id}) as used`).then((r) => r.rows);
    return row.used;
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.db.delete(permissions).where(eq(permissions.id, id)).returning({ id: permissions.id });
    this.groupMap = null;
    return rows.length > 0;
  }
}
