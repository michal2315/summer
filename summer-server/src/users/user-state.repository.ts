import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { CurrentUser } from '../auth/identity-provider';
import { collectionVisible } from '../collections/collection.access';
import { idsWhere } from '../common/sql';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DatabaseService } from '../database/database.service';
import {
  collections,
  summaries,
  userFavCollections,
  userFavLabels,
  userFavSummaries,
  userFollows,
  userPinnedCollections,
  userPinnedLabels,
  userPinnedPermissions,
  userPinnedSearches,
} from '../database/schema';
import { summaryVisible } from '../summaries/summary.access';

/** Per-user pins, favourites and follows. Every operation is idempotent under retries (composite primary keys). */
@Injectable()
export class UserStateRepository {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly database: DatabaseService,
  ) {}

  private get db() {
    return this.database.db;
  }

  /** Favourites and pins only target things the caller can see. */
  async canSeeSummary(me: CurrentUser, summaryId: string): Promise<boolean> {
    return (await idsWhere(this.db, summaries, summaries.id, [summaryId], summaryVisible(me, this.config.access))).has(summaryId);
  }

  async canSeeCollection(me: CurrentUser, collectionId: string): Promise<boolean> {
    return (await idsWhere(this.db, collections, collections.id, [collectionId], collectionVisible(me))).has(collectionId);
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

  async toggleCollection(kind: 'pinned' | 'favorite', userId: string, collectionId: string): Promise<void> {
    const t = kind === 'pinned' ? userPinnedCollections : userFavCollections;
    const removed = await this.db
      .delete(t)
      .where(and(eq(t.userId, userId), eq(t.collectionId, collectionId)))
      .returning({ id: t.collectionId });
    if (!removed.length) await this.db.insert(t).values({ userId, collectionId }).onConflictDoNothing();
  }

  async togglePinnedPermission(userId: string, permissionId: string): Promise<void> {
    const t = userPinnedPermissions;
    const removed = await this.db
      .delete(t)
      .where(and(eq(t.userId, userId), eq(t.permissionId, permissionId)))
      .returning({ id: t.permissionId });
    if (!removed.length) await this.db.insert(t).values({ userId, permissionId }).onConflictDoNothing();
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

  async addPinnedSearch(userId: string, search: Record<string, unknown>): Promise<void> {
    await this.db.insert(userPinnedSearches).values({ userId, search });
  }
}
