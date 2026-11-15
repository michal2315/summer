import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
  /** also alert right away */
  alert: alertBody.optional(),
});

const updateBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(QUERY_KINDS).optional(),
  search: z.unknown().optional(),
  isFavorite: z.boolean().optional(),
});

/** An advanced-search tree can only be edited in the builder, so a query that has one is advanced. */
const kindFor = (kind: QueryKind, search: Record<string, unknown>): QueryKind => (search.query ? 'advanced' : kind);

const toApi = ({ query: q, alert: a }: QueryWithAlert): ApiQuery => ({
  _id: q.id,
  name: q.name,
  kind: q.kind,
  search: q.search,
  isFavorite: q.isFavorite,
  creationDate: q.createdAt.toISOString(),
  updateDate: q.updatedAt.toISOString(),
  alert: a ? { _id: a.id, isActive: a.isActive, isMail: a.isMail, isDigest: a.isDigest, creationDate: a.createdAt.toISOString() } : null,
});

/**
 * The caller's queries. A query is a saved search; its alert (one per user) notifies about summaries it finds
 * later. Two queries of one owner never select the same summaries (the second would be a duplicate).
 */
@Injectable()
export class QueriesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly repo: QueriesRepository,
  ) {}

  async list(me: CurrentUser): Promise<ApiQuery[]> {
    return (await this.repo.ownedBy(me.id)).map(toApi);
  }

  async create(me: CurrentUser, body: unknown): Promise<ApiQuery> {
    const input = parse(createBody, body);
    const search = cleanSearch(input.search);
    const id = await this.database.transaction(async () => {
      const mine = await this.repo.ownedBy(me.id);
      if (mine.length >= MAX_QUERIES) throw new BadRequestException(`up to ${MAX_QUERIES} saved searches`);
      this.assertUnique(mine, search);
      const row = await this.repo.insert(me.id, { name: input.name, kind: kindFor(input.kind, search), search, isFavorite: input.isFavorite });
      if (input.alert) await this.repo.upsertAlert(row.id, me.id, input.alert);
      return row.id;
    });
    return this.get(me, id);
  }

  async update(me: CurrentUser, id: string, body: unknown): Promise<ApiQuery> {
    const input = parse(updateBody, body);
    await this.database.transaction(async () => {
      const current = await this.repo.one(me.id, id);
      if (!current) throw new NotFoundException();
      const search = input.search === undefined ? undefined : cleanSearch(input.search);
      if (search) this.assertUnique(await this.repo.ownedBy(me.id), search, id);
      const kind = kindFor(input.kind ?? current.query.kind, search ?? current.query.search);
      await this.repo.update(me.id, id, { ...(input.name !== undefined ? { name: input.name } : {}), ...(search ? { search } : {}), ...(input.isFavorite !== undefined ? { isFavorite: input.isFavorite } : {}), kind });
    });
    return this.get(me, id);
  }

  async remove(me: CurrentUser, id: string): Promise<void> {
    if (!(await this.repo.delete(me.id, id))) throw new NotFoundException();
  }

  /** Turn on (or change) the caller's alert on their query. A new alert is active unless said otherwise. */
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

  private async get(me: CurrentUser, id: string): Promise<ApiQuery> {
    const row = await this.repo.one(me.id, id);
    if (!row) throw new NotFoundException();
    return toApi(row);
  }

  private assertUnique(mine: QueryWithAlert[], search: Record<string, unknown>, except?: string): void {
    const key = searchKey(search);
    const clash = mine.find((q) => q.query.id !== except && searchKey(q.query.search) === key);
    if (clash) throw new ConflictException(`already saved as "${clash.query.name}"`);
  }
}
