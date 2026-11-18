import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/identity-provider';
import { ApiQuery } from '../common/api-types';
import { parse } from '../common/validation';
import { DatabaseService } from '../database/database.service';
import { QUERY_KINDS, QueryKind } from '../database/schema';
import { QueriesRepository, QueryWithAlert } from './queries.repository';
import { cleanSearch, searchKey } from './query-search';

const MAX_QUERIES = 100;

const alertBody = z.object({ isActive: z.boolean().optional(), isMail: z.boolean().optional(), isDigest: z.boolean().optional() });

const createBody = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(QUERY_KINDS).default('simple'),
  search: z.unknown(),
  isFavorite: z.boolean().default(false),
  isShared: z.boolean().default(false),
  /** also alert right away */
  alert: alertBody.optional(),
});

const updateBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(QUERY_KINDS).optional(),
  search: z.unknown().optional(),
  isFavorite: z.boolean().optional(),
  isShared: z.boolean().optional(),
});

const copyBody = z.object({ name: z.string().trim().min(1).max(120).optional() });

const sharedQuery = z.object({
  q: z.string().trim().max(120).default(''),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});
const SHARED_PAGE = 30;

/** An advanced-search tree can only be edited in the builder, so a query that has one is advanced. */
const kindFor = (kind: QueryKind, search: Record<string, unknown>): QueryKind => (search.query ? 'advanced' : kind);

const toApi =
  (me: CurrentUser) =>
  ({ query: q, alert: a, owner, followers }: QueryWithAlert): ApiQuery => ({
    _id: q.id,
    name: q.name,
    kind: q.kind,
    search: q.search,
    isFavorite: q.ownerId === me.id && q.isFavorite,
    isShared: q.isShared,
    isMine: q.ownerId === me.id,
    owner: { _id: owner.id, username: owner.username, fullName: owner.fullName },
    followers,
    creationDate: q.createdAt.toISOString(),
    updateDate: q.updatedAt.toISOString(),
    alert: a ? { _id: a.id, isActive: a.isActive, isMail: a.isMail, isDigest: a.isDigest, creationDate: a.createdAt.toISOString() } : null,
  });

/**
 * Queries. A query is a saved search of its owner's; its alerts (one per user) notify about summaries it finds later.
 * A shared query can also be found, run, copied and alerted on by everyone else; unsharing it drops their alerts.
 * Two queries of one owner never select the same summaries (the second would be a duplicate).
 */
@Injectable()
export class QueriesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly repo: QueriesRepository,
  ) {}

  /** The caller's own queries, then others' shared queries they alert on. */
  async list(me: CurrentUser): Promise<ApiQuery[]> {
    const [mine, followed] = await Promise.all([this.repo.ownedBy(me.id), this.repo.followedBy(me.id)]);
    return [...mine, ...followed].map(toApi(me));
  }

  /** Others' shared queries, a page at a time; `q` narrows by name or owner. */
  async shared(me: CurrentUser, query: unknown): Promise<ApiQuery[]> {
    const { q, offset } = parse(sharedQuery, query);
    return (await this.repo.shared(me.id, q, SHARED_PAGE, offset)).map(toApi(me));
  }

  async create(me: CurrentUser, body: unknown): Promise<ApiQuery> {
    const input = parse(createBody, body);
    const search = cleanSearch(input.search);
    const id = await this.database.transaction(async () => {
      const row = await this.insertMine(me, { name: input.name, kind: kindFor(input.kind, search), search, isFavorite: input.isFavorite, isShared: input.isShared });
      if (input.alert) await this.repo.upsertAlert(row.id, me.id, input.alert);
      return row.id;
    });
    return this.get(me, id);
  }

  /** A copy of a query (the caller's or a shared one) as the caller's own, private; it no longer follows the original. */
  async copy(me: CurrentUser, id: string, body: unknown): Promise<ApiQuery> {
    const { name } = parse(copyBody, body ?? {});
    const source = await this.get(me, id);
    const search = cleanSearch(source.search);
    const row = await this.database.transaction(() =>
      this.insertMine(me, { name: name ?? (source.isMine ? `${source.name} (עותק)` : source.name), kind: kindFor(source.kind, search), search, isFavorite: false }),
    );
    return this.get(me, row.id);
  }

  async update(me: CurrentUser, id: string, body: unknown): Promise<ApiQuery> {
    const input = parse(updateBody, body);
    await this.database.transaction(async () => {
      const current = await this.owned(me, id);
      const search = input.search === undefined ? undefined : cleanSearch(input.search);
      if (search) this.assertUnique(await this.repo.ownedBy(me.id), search, id);
      const kind = kindFor(input.kind ?? current.query.kind, search ?? current.query.search);
      await this.repo.update(me.id, id, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(search ? { search } : {}),
        ...(input.isFavorite !== undefined ? { isFavorite: input.isFavorite } : {}),
        ...(input.isShared !== undefined ? { isShared: input.isShared } : {}),
        kind,
      });
      if (input.isShared === false && current.query.isShared) await this.repo.deleteOthersAlerts(id, me.id);
    });
    return this.get(me, id);
  }

  async remove(me: CurrentUser, id: string): Promise<void> {
    await this.owned(me, id);
    if (!(await this.repo.delete(me.id, id))) throw new NotFoundException();
  }

  /** Turn on (or change) the caller's alert on a query of theirs or a shared one. A new alert is active unless said otherwise. */
  async setAlert(me: CurrentUser, id: string, body: unknown): Promise<ApiQuery> {
    const values = parse(alertBody, body ?? {});
    await this.get(me, id);
    await this.repo.upsertAlert(id, me.id, values);
    return this.get(me, id);
  }

  async removeAlert(me: CurrentUser, id: string): Promise<ApiQuery> {
    await this.get(me, id);
    await this.repo.deleteAlert(id, me.id);
    return this.get(me, id);
  }

  /** One query the caller may see: theirs, or a shared one. */
  async get(me: CurrentUser, id: string): Promise<ApiQuery> {
    const row = await this.repo.one(me.id, id);
    if (!row) throw new NotFoundException();
    return toApi(me)(row);
  }

  /** Only the owner changes or deletes a query. */
  private async owned(me: CurrentUser, id: string): Promise<QueryWithAlert> {
    const row = await this.repo.one(me.id, id);
    if (!row) throw new NotFoundException();
    if (row.query.ownerId !== me.id) throw new ForbiddenException('only the owner can change this search');
    return row;
  }

  private async insertMine(me: CurrentUser, values: Parameters<QueriesRepository['insert']>[1]) {
    const mine = await this.repo.ownedBy(me.id);
    if (mine.length >= MAX_QUERIES) throw new BadRequestException(`up to ${MAX_QUERIES} saved searches`);
    this.assertUnique(mine, values.search);
    return this.repo.insert(me.id, values);
  }

  private assertUnique(mine: QueryWithAlert[], search: Record<string, unknown>, except?: string): void {
    const key = searchKey(search);
    const clash = mine.find((q) => q.query.id !== except && searchKey(q.query.search) === key);
    if (clash) throw new ConflictException(`already saved as "${clash.query.name}"`);
  }
}
