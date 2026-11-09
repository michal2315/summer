import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { CurrentUser } from '../auth/identity-provider';
import { idsWhere } from '../common/sql';
import { DatabaseService } from '../database/database.service';
import {
  summaries,
  userFavLabels,
  userFavSummaries,
  userFollows,
  userPinnedLabels,
  userPinnedPermissions,
  userPinnedSearches,
  userPinnedUsers,
} from '../database/schema';
import { summaryVisible } from '../summaries/summary.access';

/** Per-user pins, favourites and follows. Every operation is idempotent under retries (composite primary keys). */
@Injectable()
export class UserStateRepository {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  /** Favourites and pins only target things the caller can see. */
  async canSeeSummary(me: CurrentUser, summaryId: string): Promise<boolean> {
    return (await idsWhere(this.db, summaries, summaries.id, [summaryId], summaryVisible(me))).has(summaryId);
  }

  async visibleSummaryIds(me: CurrentUser, summaryIds: string[]): Promise<Set<string>> {
    return idsWhere(this.db, summaries, summaries.id, summaryIds, summaryVisible(me));
  }

  /** Flip membership: remove if present, else add. */
  async toggleLabel(kind: 'pinned' | 'favorite', userId: string, labelId: string): Promise<void> {
    const t = kind === 'pinned' ? userPinnedLabels : userFavLabels;
    const removed = await this.db
      .delete(t)
      .where(and(eq(t.userId, userId), eq(t.labelId, labelId)))
      .returning({ id: t.labelId });
    if (!removed.length) await this.db.insert(t).values({ userId, labelId }).onConflictDoNothing();
  }

  async togglePinnedPermission(userId: string, permissionId: string): Promise<void> {
    const t = userPinnedPermissions;
    const removed = await this.db
      .delete(t)
      .where(and(eq(t.userId, userId), eq(t.permissionId, permissionId)))
      .returning({ id: t.permissionId });
    if (!removed.length) await this.db.insert(t).values({ userId, permissionId }).onConflictDoNothing();
  }

  /** `beforeAdd` runs only when adding (it may throw to refuse). */
  async togglePinnedUser(userId: string, pinnedUserId: string, beforeAdd: () => Promise<void>): Promise<void> {
    const t = userPinnedUsers;
    const removed = await this.db
      .delete(t)
      .where(and(eq(t.userId, userId), eq(t.pinnedUserId, pinnedUserId)))
      .returning({ id: t.pinnedUserId });
    if (removed.length) return;
    await beforeAdd();
    await this.db.insert(t).values({ userId, pinnedUserId }).onConflictDoNothing();
  }

  /** Returns true when the summary is now a favourite. */
  async toggleFavoriteSummary(userId: string, summaryId: string, canAdd: () => Promise<boolean>): Promise<boolean> {
    const t = userFavSummaries;
    const removed = await this.db
      .delete(t)
      .where(and(eq(t.userId, userId), eq(t.summaryId, summaryId)))
      .returning({ id: t.summaryId });
    if (removed.length) return false;
    if (!(await canAdd())) return false;
    await this.db.insert(t).values({ userId, summaryId }).onConflictDoNothing();
    return true;
  }

  async setFavoriteSummaries(userId: string, summaryIds: string[], favorite: boolean): Promise<void> {
    if (!summaryIds.length) return;
    const t = userFavSummaries;
    if (favorite) await this.db.insert(t).values(summaryIds.map((summaryId) => ({ userId, summaryId }))).onConflictDoNothing();
    else await this.db.delete(t).where(and(eq(t.userId, userId), inArray(t.summaryId, summaryIds)));
  }

  async follow(followerId: string, followedId: string): Promise<void> {
    await this.db.insert(userFollows).values({ followerId, followedId }).onConflictDoNothing();
  }

  async unfollow(followerId: string, followedId: string): Promise<void> {
    await this.db.delete(userFollows).where(and(eq(userFollows.followerId, followerId), eq(userFollows.followedId, followedId)));
  }

  pinnedSearches(userId: string) {
    return this.db.select().from(userPinnedSearches).where(eq(userPinnedSearches.userId, userId));
  }

  async deletePinnedSearch(id: string): Promise<void> {
    await this.db.delete(userPinnedSearches).where(eq(userPinnedSearches.id, id));
  }

  async addPinnedSearch(userId: string, search: Record<string, unknown>, name: string | null): Promise<void> {
    await this.db.insert(userPinnedSearches).values({ userId, search, name });
  }

  /** False when the search is not the user's. */
  async renamePinnedSearch(userId: string, id: string, name: string | null): Promise<boolean> {
    const rows = await this.db
      .update(userPinnedSearches)
      .set({ name })
      .where(and(eq(userPinnedSearches.id, id), eq(userPinnedSearches.userId, userId)))
      .returning({ id: userPinnedSearches.id });
    return rows.length > 0;
  }
}
