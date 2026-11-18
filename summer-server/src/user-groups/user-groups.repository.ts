import { Injectable } from '@nestjs/common';
import { SQL, and, asc, desc, eq, inArray, ne, or } from 'drizzle-orm';
import { UserRef, toRef } from '../common/api-types';
import { textLike } from '../common/sql';
import { DatabaseService } from '../database/database.service';
import { userGroupPermissions, userGroupUsers, userGroups, users } from '../database/schema';

export type UserGroupRow = typeof userGroups.$inferSelect;
export type UserGroupValues = Pick<UserGroupRow, 'name' | 'isFavorite' | 'isShared'>;

/** A user group with its owner and members (active users only), in the order they were added. */
export interface UserGroupWithMembers {
  group: UserGroupRow;
  owner: UserRef;
  users: UserRef[];
  permissions: string[];
}

const ownerColumns = { id: users.id, username: users.username, fullName: users.fullName, department: users.department, isSystem: users.isSystem };

@Injectable()
export class UserGroupsRepository {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  /** Groups the user may see: their own, and shared ones. */
  private visible(userId: string): SQL {
    return or(eq(userGroups.ownerId, userId), eq(userGroups.isShared, true))!;
  }

  private select() {
    return this.db.select({ group: userGroups, owner: ownerColumns }).from(userGroups).innerJoin(users, eq(users.id, userGroups.ownerId));
  }

  /** Members of the given groups, fetched in two queries. */
  private async withMembers(rows: { group: UserGroupRow; owner: Parameters<typeof toRef>[0] }[]): Promise<UserGroupWithMembers[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.group.id);
    const [members, perms] = await Promise.all([
      this.db
        .select({ groupId: userGroupUsers.groupId, user: ownerColumns })
        .from(userGroupUsers)
        .innerJoin(users, eq(users.id, userGroupUsers.userId))
        .where(and(inArray(userGroupUsers.groupId, ids), eq(users.isActive, true), eq(users.isSystem, false)))
        .orderBy(asc(userGroupUsers.createdAt), asc(users.fullName)),
      this.db
        .select({ groupId: userGroupPermissions.groupId, permissionId: userGroupPermissions.permissionId })
        .from(userGroupPermissions)
        .where(inArray(userGroupPermissions.groupId, ids))
        .orderBy(asc(userGroupPermissions.createdAt)),
    ]);
    return rows.map(({ group, owner }) => ({
      group,
      owner: toRef(owner),
      users: members.filter((m) => m.groupId === group.id).map((m) => toRef(m.user)),
      permissions: perms.filter((p) => p.groupId === group.id).map((p) => p.permissionId),
    }));
  }

  /** The user's own groups: favourites first, then by name. */
  async ownedBy(userId: string): Promise<UserGroupWithMembers[]> {
    return this.withMembers(await this.select().where(eq(userGroups.ownerId, userId)).orderBy(desc(userGroups.isFavorite), asc(userGroups.name), asc(userGroups.id)));
  }

  /** How many groups the user owns. */
  async countOwned(userId: string): Promise<number> {
    return this.db.$count(userGroups, eq(userGroups.ownerId, userId));
  }

  /** The user's own group with this name (case-insensitive), if any. */
  async ownedByName(userId: string, name: string): Promise<UserGroupRow | undefined> {
    const rows = await this.db.select().from(userGroups).where(eq(userGroups.ownerId, userId));
    const key = name.trim().toLowerCase();
    return rows.find((r) => r.name.trim().toLowerCase() === key);
  }

  /** Others' shared groups (active owners), newest change first; `text` narrows by name or owner. */
  async shared(userId: string, text: string, limit: number, offset: number): Promise<UserGroupWithMembers[]> {
    const rows = await this.select()
      .where(
        and(
          eq(userGroups.isShared, true),
          ne(userGroups.ownerId, userId),
          eq(users.isActive, true),
          text ? or(textLike(userGroups.name, text), textLike(users.fullName, text), textLike(users.username, text)) : undefined,
        ),
      )
      .orderBy(desc(userGroups.updatedAt), asc(userGroups.id))
      .limit(limit)
      .offset(offset);
    return this.withMembers(rows);
  }

  /** One group the user may see (theirs, or shared). */
  async one(userId: string, id: string): Promise<UserGroupWithMembers | undefined> {
    const [row] = await this.withMembers(await this.select().where(and(eq(userGroups.id, id), this.visible(userId))));
    return row;
  }

  async insert(ownerId: string, values: UserGroupValues): Promise<UserGroupRow> {
    const [row] = await this.db.insert(userGroups).values({ ownerId, ...values }).returning();
    return row;
  }

  async update(ownerId: string, id: string, patch: Partial<UserGroupValues>): Promise<boolean> {
    const rows = await this.db
      .update(userGroups)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(userGroups.id, id), eq(userGroups.ownerId, ownerId)))
      .returning({ id: userGroups.id });
    return rows.length > 0;
  }

  async delete(ownerId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(userGroups)
      .where(and(eq(userGroups.id, id), eq(userGroups.ownerId, ownerId)))
      .returning({ id: userGroups.id });
    return rows.length > 0;
  }

  /** Replace the group's members, keeping the order given (a moment apart, so `createdAt` orders them). */
  async setMembers(groupId: string, userIds: string[], permissionIds: string[]): Promise<void> {
    const at = (i: number) => new Date(Date.now() + i);
    await this.db.delete(userGroupUsers).where(eq(userGroupUsers.groupId, groupId));
    await this.db.delete(userGroupPermissions).where(eq(userGroupPermissions.groupId, groupId));
    if (userIds.length) await this.db.insert(userGroupUsers).values(userIds.map((userId, i) => ({ groupId, userId, createdAt: at(i) })));
    if (permissionIds.length) await this.db.insert(userGroupPermissions).values(permissionIds.map((permissionId, i) => ({ groupId, permissionId, createdAt: at(i) })));
  }
}
