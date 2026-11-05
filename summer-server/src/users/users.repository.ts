import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { ApiUser, UserRef, toRef } from '../common/api-types';
import { DatabaseService } from '../database/database.service';
import {
  labels,
  userFavLabels,
  userFollows,
  userPinnedLabels,
  userPinnedPermissions,
  userPinnedSearches,
  userPinnedUsers,
  users,
} from '../database/schema';
import { VerifiedIdentity } from '../auth/identity-provider';
import { textLike } from '../common/sql';

export type UserRow = typeof users.$inferSelect;

const LOOKUP_LIMIT = 20;
const refColumns = { id: users.id, username: users.username, fullName: users.fullName, department: users.department, isSystem: users.isSystem };

@Injectable()
export class UsersRepository {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  /** Create the account on first sign-in; refresh display fields when the directory changed them. */
  async upsertIdentity(identity: VerifiedIdentity): Promise<UserRow> {
    const match = and(eq(users.authIssuer, identity.issuer), eq(users.authSubject, identity.subject));
    const profile = {
      username: identity.username,
      fullName: identity.fullName,
      department: identity.department,
      email: identity.email ?? null,
      isSystem: identity.isSystem ?? false,
      lastGroupKeys: [...identity.groupKeys].sort(),
    };
    const changed = (row: UserRow) =>
      Object.entries(profile).some(([k, v]) => {
        const cur = row[k as keyof typeof profile];
        return Array.isArray(v) ? JSON.stringify(v) !== JSON.stringify(cur) : cur !== v;
      });
    let [row] = await this.db.select().from(users).where(match);
    if (!row) {
      await this.db
        .insert(users)
        .values({ authIssuer: identity.issuer, authSubject: identity.subject, ...profile })
        .onConflictDoNothing({ target: [users.authIssuer, users.authSubject] });
      [row] = await this.db.select().from(users).where(match);
    } else if (changed(row)) {
      [row] = await this.db
        .update(users)
        .set({ ...profile, updatedAt: new Date() })
        .where(eq(users.id, row.id))
        .returning();
    }
    return row;
  }

  async findById(id: string): Promise<UserRow | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id));
    return row;
  }

  async refByUsername(username: string): Promise<UserRef | undefined> {
    const [row] = await this.db.select(refColumns).from(users).where(and(eq(users.username, username), eq(users.isActive, true)));
    return row && toRef(row);
  }

  async refsByIds(ids: string[]): Promise<UserRef[]> {
    if (!ids.length) return [];
    const rows = await this.db.select(refColumns).from(users).where(inArray(users.id, ids));
    return rows.map(toRef);
  }

  /** Existing, active, non-system users among `ids`. */
  async existingIds(ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, ids), eq(users.isActive, true), eq(users.isSystem, false)));
    return rows.map((r) => r.id);
  }

  /** Mention / tag autocomplete: username prefix or name substring. */
  async search(text: string, usernamePrefix: boolean): Promise<UserRef[]> {
    const nameMatch = textLike(users.fullName, text);
    const rows = await this.db
      .select(refColumns)
      .from(users)
      .where(
        and(
          eq(users.isActive, true),
          eq(users.isSystem, false),
          usernamePrefix ? or(textLike(users.username, text, 'prefix'), nameMatch) : nameMatch,
        ),
      )
      .orderBy(asc(users.fullName))
      .limit(LOOKUP_LIMIT);
    return rows.map(toRef);
  }

  /** The full IUser document the client caches (pins, favourites, follows). */
  async apiUser(userId: string): Promise<ApiUser | undefined> {
    const user = await this.findById(userId);
    if (!user) return undefined;
    const ids = async (table: PgTable & { userId: PgColumn; createdAt: PgColumn }, column: PgColumn) =>
      (await this.db.select({ v: column }).from(table).where(eq(table.userId, userId)).orderBy(asc(table.createdAt))).map((r) => r.v as string);
    const labelNames = async (table: typeof userPinnedLabels | typeof userFavLabels) =>
      (
        await this.db
          .select({ name: labels.name })
          .from(table)
          .innerJoin(labels, eq(labels.id, table.labelId))
          .where(eq(table.userId, userId))
          .orderBy(asc(table.createdAt))
      ).map((r) => r.name);

    const [pinnedSearches, pinnedLabels, favoriteLabels, pinnedPermissions, pinnedUsers, following] = await Promise.all([
      this.db
        .select({ search: userPinnedSearches.search })
        .from(userPinnedSearches)
        .where(eq(userPinnedSearches.userId, userId))
        .orderBy(asc(userPinnedSearches.createdAt))
        .then((rows) => rows.map((r) => r.search).reverse()),
      labelNames(userPinnedLabels),
      labelNames(userFavLabels),
      ids(userPinnedPermissions, userPinnedPermissions.permissionId),
      this.db
        .select(refColumns)
        .from(userPinnedUsers)
        .innerJoin(users, eq(users.id, userPinnedUsers.pinnedUserId))
        .where(and(eq(userPinnedUsers.userId, userId), eq(users.isActive, true)))
        .orderBy(asc(userPinnedUsers.createdAt))
        .then((rows) => rows.map(toRef)),
      this.db
        .select({ v: userFollows.followedId })
        .from(userFollows)
        .where(eq(userFollows.followerId, userId))
        .orderBy(asc(userFollows.createdAt))
        .then((rows) => rows.map((r) => r.v)),
    ]);

    return {
      ...toRef(user),
      pinnedSearches,
      pinnedLabels,
      favoriteLabels,
      pinnedPermissions,
      pinnedUsers,
      following,
      recentExtraField: [],
    };
  }
}
