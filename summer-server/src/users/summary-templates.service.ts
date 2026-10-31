import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/identity-provider';
import { ApiSummaryTemplate } from '../common/api-types';
import { parse, unique, zId } from '../common/validation';
import { DatabaseService } from '../database/database.service';
import { SummaryTemplatesRepository } from './summary-templates.repository';
import { UsersRepository } from './users.repository';

const MAX_TEMPLATES = 30;

const templateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  permissions: z.array(zId).max(100).default([]),
  taggedUsers: z.array(zId).max(200).default([]),
  taggedPermissions: z.array(zId).max(100).default([]),
  labels: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  collections: z.array(zId).max(200).default([]),
  folder: zId.nullable().default(null),
});

/** Personal summary-form templates. Every mutation returns the caller's refreshed list. */
@Injectable()
export class SummaryTemplatesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly templates: SummaryTemplatesRepository,
    private readonly users: UsersRepository,
  ) {}

  /** Users and collections come back with their names, minus the ones that are gone or no longer visible. */
  async list(me: CurrentUser): Promise<ApiSummaryTemplate[]> {
    const rows = await this.templates.list(me.id);
    const userIds = unique(rows.flatMap((r) => r.data.taggedUsers));
    const collectionIds = unique(rows.flatMap((r) => r.data.collections));
    const [users, collections] = await Promise.all([
      this.users.existingIds(userIds).then((ids) => this.users.refsByIds(ids)),
      this.templates.visibleCollectionRefs(me, collectionIds),
    ]);
    const userById = new Map(users.map((u) => [u._id, u]));
    const collectionById = new Map(collections.map((c) => [c.id, { _id: c.id, name: c.name }]));
    return rows.map((r) => ({
      _id: r.id,
      name: r.name,
      permissions: r.data.permissions,
      taggedUsers: r.data.taggedUsers.flatMap((id) => userById.get(id) ?? []),
      taggedPermissions: r.data.taggedPermissions ?? [],
      labels: r.data.labels,
      collections: r.data.collections.flatMap((id) => collectionById.get(id) ?? []),
      folder: r.data.folder,
    }));
  }

  async save(me: CurrentUser, body: unknown): Promise<ApiSummaryTemplate[]> {
    const { name, ...v } = parse(templateSchema, body);
    const data = {
      permissions: unique(v.permissions),
      taggedUsers: unique(v.taggedUsers),
      taggedPermissions: unique(v.taggedPermissions),
      labels: unique(v.labels),
      collections: unique(v.collections),
      folder: v.folder,
    };
    await this.database.transaction(async () => {
      if (!(await this.templates.exists(me.id, name)) && (await this.templates.countFor(me.id)) >= MAX_TEMPLATES)
        throw new BadRequestException('too many templates');
      await this.templates.upsert(me.id, name, data);
    });
    return this.list(me);
  }

  async delete(me: CurrentUser, id: string): Promise<ApiSummaryTemplate[]> {
    if (!(await this.templates.delete(me.id, id))) throw new NotFoundException();
    return this.list(me);
  }
}
