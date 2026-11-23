import { Injectable } from '@nestjs/common';
import { SQL, and, asc, desc, eq, exists, inArray, ne, or } from 'drizzle-orm';
import { UserRef, toRef } from '../common/api-types';
import { textLike } from '../common/sql';
import { DatabaseService } from '../database/database.service';
import { PouchRole, pouchFormatMembers, pouchFormats, users } from '../database/schema';

export type PouchFormatRow = typeof pouchFormats.$inferSelect;
export type PouchFormatValues = Pick<PouchFormatRow, 'name' | 'mode' | 'doc' | 'page' | 'isFavorite' | 'isShared'>;

export interface PouchMember {
  user: UserRef;
  role: PouchRole;
}

/** A format with its owner and the people it's shared with (active users only, in the order they were added). */
export interface PouchFormatWithOwner {
  format: PouchFormatRow;
  owner: UserRef;
  members: PouchMember[];
}

const userColumns = { id: users.id, username: users.username, fullName: users.fullName, department: users.department, isSystem: users.isSystem };

@Injectable()
export class PouchRepository {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  /** The format was shared with the user personally (any role). */
  private sharedWith(userId: string): SQL {
    return exists(
      this.db
        .select({ one: pouchFormatMembers.userId })
        .from(pouchFormatMembers)
        .where(and(eq(pouchFormatMembers.formatId, pouchFormats.id), eq(pouchFormatMembers.userId, userId))),
    );
  }

  /** Formats the user may see: their own, ones shared with them, and ones shared with everyone. */
  private visible(userId: string): SQL {
    return or(eq(pouchFormats.ownerId, userId), eq(pouchFormats.isShared, true), this.sharedWith(userId))!;
  }

  private async select(where: SQL | undefined, order: SQL[], limit?: number, offset?: number): Promise<PouchFormatWithOwner[]> {
    let q = this.db
      .select({ format: pouchFormats, owner: userColumns })
      .from(pouchFormats)
      .innerJoin(users, eq(users.id, pouchFormats.ownerId))
      .where(where)
      .orderBy(...order)
      .$dynamic();
    if (limit !== undefined) q = q.limit(limit).offset(offset ?? 0);
    const rows = await q;
    if (!rows.length) return [];
    const members = await this.db
      .select({ formatId: pouchFormatMembers.formatId, role: pouchFormatMembers.role, user: userColumns })
      .from(pouchFormatMembers)
      .innerJoin(users, eq(users.id, pouchFormatMembers.userId))
      .where(and(inArray(pouchFormatMembers.formatId, rows.map((r) => r.format.id)), eq(users.isActive, true), eq(users.isSystem, false)))
      .orderBy(asc(pouchFormatMembers.createdAt), asc(users.fullName));
    return rows.map((r) => ({
      format: r.format,
      owner: toRef(r.owner),
      members: members.filter((m) => m.formatId === r.format.id).map((m) => ({ user: toRef(m.user), role: m.role })),
    }));
  }

  /** The user's own formats and the ones shared with them personally: favourites first, then by name. */
  mine(userId: string): Promise<PouchFormatWithOwner[]> {
    return this.select(and(or(eq(pouchFormats.ownerId, userId), this.sharedWith(userId)), eq(users.isActive, true)), [
      desc(pouchFormats.isFavorite),
      asc(pouchFormats.name),
      asc(pouchFormats.id),
    ]);
  }

  countOwned(userId: string): Promise<number> {
    return this.db.$count(pouchFormats, eq(pouchFormats.ownerId, userId));
  }

  /** The user's own format with this name (case-insensitive), if any. */
  async ownedByName(userId: string, name: string): Promise<{ id: string; name: string } | undefined> {
    const rows = await this.db.select({ id: pouchFormats.id, name: pouchFormats.name }).from(pouchFormats).where(eq(pouchFormats.ownerId, userId));
    const key = name.trim().toLowerCase();
    return rows.find((r) => r.name.trim().toLowerCase() === key);
  }

  /** Others' shared formats (active owners), newest change first; `text` narrows by name or owner. */
  shared(userId: string, text: string, limit: number, offset: number): Promise<PouchFormatWithOwner[]> {
    return this.select(
      and(
        eq(pouchFormats.isShared, true),
        ne(pouchFormats.ownerId, userId),
        eq(users.isActive, true),
        text ? or(textLike(pouchFormats.name, text), textLike(users.fullName, text), textLike(users.username, text)) : undefined,
      ),
      [desc(pouchFormats.updatedAt), asc(pouchFormats.id)],
      limit,
      offset,
    );
  }

  /** One format the user may see (theirs, shared with them, or with everyone). */
  async one(userId: string, id: string): Promise<PouchFormatWithOwner | undefined> {
    const [row] = await this.select(and(eq(pouchFormats.id, id), this.visible(userId)), []);
    return row;
  }

  async insert(ownerId: string, values: PouchFormatValues): Promise<PouchFormatRow> {
    const [row] = await this.db.insert(pouchFormats).values({ ownerId, ...values }).returning();
    return row;
  }

  /** Change a format (the service has checked the caller may). */
  async update(id: string, patch: Partial<PouchFormatValues>): Promise<boolean> {
    const rows = await this.db
      .update(pouchFormats)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(pouchFormats.id, id))
      .returning({ id: pouchFormats.id });
    return rows.length > 0;
  }

  async delete(ownerId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(pouchFormats)
      .where(and(eq(pouchFormats.id, id), eq(pouchFormats.ownerId, ownerId)))
      .returning({ id: pouchFormats.id });
    return rows.length > 0;
  }

  /** Replace who the format is shared with, keeping the order given (a moment apart, so `createdAt` orders them). */
  async setMembers(formatId: string, members: { userId: string; role: PouchRole }[]): Promise<void> {
    const at = (i: number) => new Date(Date.now() + i);
    await this.db.delete(pouchFormatMembers).where(eq(pouchFormatMembers.formatId, formatId));
    if (members.length) await this.db.insert(pouchFormatMembers).values(members.map((m, i) => ({ formatId, userId: m.userId, role: m.role, createdAt: at(i) })));
  }
}
