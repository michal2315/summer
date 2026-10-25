import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/identity-provider';
import { ApiNotification } from '../common/api-types';
import { isUuid, parse, unique } from '../common/validation';
import { ContentTypesRepository } from '../content-types/content-types.repository';
import { RuleCondition } from '../database/schema';
import { PermissionsRepository } from '../permissions/permissions.repository';
import { NotificationsRepository, RuleRow } from './notifications.repository';
import { RULE_FUNCTIONS, matchRule } from './rule-matcher';

const ruleBody = z.object({
  _id: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  conditions: z
    .array(
      z.object({
        field: z.object({ _id: z.string() }).passthrough(),
        funcName: z.enum(RULE_FUNCTIONS),
        content: z.array(z.union([z.string().max(500), z.number(), z.null()])).max(2),
      }),
    )
    .min(1)
    .max(20),
  isMail: z.boolean().default(false),
  isNotify: z.boolean().default(true),
});

export interface ApiRule {
  _id: string;
  name: string;
  conditions: RuleCondition[];
  isMail: boolean;
  isNotify: boolean;
  creationDate: string;
}

const toApiRule = (r: RuleRow): ApiRule => ({
  _id: r.id,
  name: r.name,
  conditions: r.conditions,
  isMail: r.isMail,
  isNotify: r.isNotify,
  creationDate: r.createdAt.toISOString(),
});

/** What fan-out needs to know about a just-published summary. */
export interface PublishedSummary {
  id: string;
  title: string;
  fieldValues: Map<string, string>;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly repo: NotificationsRepository,
    private readonly contentTypes: ContentTypesRepository,
    private readonly permissions: PermissionsRepository,
  ) {}

  /**
   * Store one notification per recipient who can (by last-known groups) see the summary. Never notifies the actor.
   * Runs inside the caller's transaction, so it commits or rolls back with the change that caused it.
   */
  async notify(recipientIds: string[], n: { summaryId: string; text: string; createdBy: string }): Promise<string[]> {
    const candidates = unique(recipientIds).filter((id) => id !== n.createdBy);
    const allowed = await this.whoCanView(candidates, n.summaryId);
    await this.repo.insertMany(allowed.map((userId) => ({ userId, summaryId: n.summaryId, text: n.text, createdBy: n.createdBy })));
    return allowed;
  }

  /**
   * Which recipients (judged by their last-known groups) can see the summary. Only decides whether to create a
   * notification; reading the inbox re-authorizes with fresh groups, so a stale cache never exposes content.
   */
  private async whoCanView(userIds: string[], summaryId: string): Promise<string[]> {
    const allowed: string[] = [];
    for (const u of await this.repo.recipients(userIds)) {
      const principal = { id: u.id, permissionIds: await this.permissions.idsForGroupKeys(u.groupKeys) } as CurrentUser;
      if (await this.repo.canView(principal, summaryId)) allowed.push(u.id);
    }
    return allowed;
  }

  /** A summary became visible to others (created published, or a draft was published): followers + matching rules. */
  async onPublished(s: PublishedSummary, author: CurrentUser): Promise<void> {
    const followers = await this.repo.followerIds(author.id);
    const notified = new Set(await this.notify(followers, { summaryId: s.id, text: `${author.fullName} פרסם/ה תמצית חדשה "${s.title}"`, createdBy: author.id }));

    for (const rule of await this.repo.activeRules()) {
      if (rule.userId === author.id || notified.has(rule.userId) || !matchRule(rule.conditions, s.fieldValues)) continue;
      const sent = await this.notify([rule.userId], { summaryId: s.id, text: `תמצית חדשה תואמת לכלל "${rule.name}": "${s.title}"`, createdBy: author.id });
      sent.forEach((id) => notified.add(id));
    }
  }

  async inbox(me: CurrentUser): Promise<ApiNotification[]> {
    const rows = await this.repo.inbox(me);
    return rows.map((r) => ({
      _id: r.id,
      text: r.text,
      summaryId: r.summaryId ?? undefined,
      creationDate: r.createdAt.toISOString(),
      isViewed: r.viewedAt !== null,
      createdBy: r.authorId ? { _id: r.authorId, username: r.authorUsername!, fullName: r.authorFullName! } : undefined,
    }));
  }

  markViewed(me: CurrentUser, id?: string): Promise<void> {
    return this.repo.markViewed(me.id, id);
  }

  async rules(me: CurrentUser): Promise<ApiRule[]> {
    return (await this.repo.rulesOf(me.id)).map(toApiRule);
  }

  async saveRule(me: CurrentUser, body: unknown, mode: 'create' | 'update'): Promise<ApiRule> {
    const { _id, ...input } = parse(ruleBody, body);
    // Snapshot field name/type from the catalog rather than trusting the client's copy.
    const fields = new Map((await this.contentTypes.fieldsByIds(unique(input.conditions.map((c) => c.field._id).filter(isUuid)))).map((f) => [f.id, f]));
    const conditions: RuleCondition[] = input.conditions.map((c) => {
      const f = fields.get(c.field._id);
      if (!f) throw new BadRequestException(`unknown field ${c.field._id}`);
      return { field: { _id: f.id, name: f.name, type: f.type }, funcName: c.funcName, content: c.content };
    });
    const values = { name: input.name, conditions, isMail: input.isMail, isNotify: input.isNotify };
    if (mode === 'create') return toApiRule(await this.repo.insertRule({ userId: me.id, ...values }));
    if (!_id || !isUuid(_id)) throw new NotFoundException();
    const row = await this.repo.updateRule(me.id, _id, values);
    if (!row) throw new NotFoundException();
    return toApiRule(row);
  }

  async deleteRule(me: CurrentUser, id: string): Promise<void> {
    if (!(await this.repo.deleteRule(me.id, id))) throw new NotFoundException();
  }
}

