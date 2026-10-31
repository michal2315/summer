import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SQL, and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { CurrentUser } from '../auth/identity-provider';
import { CapsulesService } from '../capsules/capsules.service';
import { ApiBulkResult, ApiSummary, SummaryLengths } from '../common/api-types';
import { htmlToText, sanitizeQuill } from '../common/html';
import { calendarDayRange, parseEventDate } from '../common/time';
import { parse, unique, zId } from '../common/validation';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ContentTypesRepository, FieldRow } from '../content-types/content-types.repository';
import { DatabaseService } from '../database/database.service';
import { FieldType, SUMMARY_KINDS, summaries } from '../database/schema';
import { LabelsRepository } from '../labels/labels.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { SUMMARY_TEXT_FIELD } from '../notifications/rule-matcher';
import { validPermissionSet } from '../permissions/permission-assignment';
import { PermissionsRepository } from '../permissions/permissions.repository';
import { UsersRepository } from '../users/users.repository';
import { FilesService, UploadedFile } from './files.service';
import { SummariesRepository, SummaryRow, SummaryValues } from './summaries.repository';
import { toApiSummary } from './summary.mapper';
import { BUCKETS, Bucket, SummarySearch, capsuleRefs, summarySearchSchema } from './summary-search';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Labels per summary, and characters per label. */
const MAX_LABELS = 100;
const MAX_LABEL = 100;
/** Summaries per bulk action (same cap as adding to a collection). */
export const BULK_MAX = 1000;

/** SummaryPayload (multipart field `summary`, JSON). */
const payloadSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(1).max(300),
  contentHtml: z.string().default(''),
  notesHtml: z.string().default(''),
  contentType: zId,
  eventDate: z.string().nullish(),
  eventSecTime: z.string().nullish(),
  department: z.string().trim().max(200).default(''),
  labels: z.array(z.string()).max(MAX_LABELS).default([]),
  collectionIds: z.array(zId).max(200).default([]),
  permissions: z.array(zId).max(100).default([]),
  taggedUsers: z.array(zId).max(200).default([]),
  /** permission groups whose members count as tagged */
  taggedPermissions: z.array(zId).max(100).default([]),
  summaryFields: z
    .array(z.object({ field: zId, value: z.union([z.string(), z.number()]).transform(String) }))
    .max(200)
    .default([]),
  /** edit: existing attachment names to keep */
  files: z.array(z.string()).max(200).default([]),
  isDraft: z.boolean().default(false),
  /** summary | running (תמצית רצף) | sumaroon (תמציתונית). Fixed at creation. */
  kind: z.enum(SUMMARY_KINDS).default('summary'),
  /** sumaroon: its running summary. Fixed at creation. */
  parentId: zId.nullish(),
  /** running: calendar-day range, yyyy-MM-dd */
  rangeStart: z.string().regex(DAY_RE).nullish(),
  rangeEnd: z.string().regex(DAY_RE).nullish(),
  /** sumaroon: source link */
  link: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => v === '' || /^https?:\/\//i.test(v), 'link must start with http:// or https://')
    .nullish(),
  /** Optional optimistic-concurrency token (ISummary does not expose it yet). */
  version: z.number().int().positive().optional(),
});
type Payload = z.output<typeof payloadSchema>;

const bulkLabelsSchema = z.object({
  summaryIds: z.array(zId).min(1).max(BULK_MAX),
  add: z.array(z.string()).max(MAX_LABELS).default([]),
  remove: z.array(z.string()).max(MAX_LABELS).default([]),
});

const COLOR_RE = /^(#[0-9a-f]{3,8})?$/i;

const bulkIdsSchema = z.object({ summaryIds: z.array(zId).min(1).max(BULK_MAX) });
const bulkColorSchema = bulkIdsSchema.extend({ color: z.string().regex(COLOR_RE, 'invalid color') });
const DASHBOARD_SCAN = 500;
const DASHBOARD_PER_GROUP = 8;

interface ValidInput {
  values: Omit<SummaryValues, 'createdBy'>;
  permissionIds: string[];
  labelNames: string[];
  fieldValues: { fieldId: string; value: string }[];
  taggedUserIds: string[];
  taggedPermissionIds: string[];
  collectionIds: string[];
  keepFiles: string[];
}

const SUMAROON_ONLY_INSIDE = 'a sumaroon lives only inside its running summary';
/** How many sumaroon titles a running summary card previews. */
const SUMAROON_PREVIEW = 3;

@Injectable()
export class SummariesService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly database: DatabaseService,
    private readonly repo: SummariesRepository,
    private readonly contentTypes: ContentTypesRepository,
    private readonly labels: LabelsRepository,
    private readonly users: UsersRepository,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
    private readonly auth: AuthService,
    private readonly permissions: PermissionsRepository,
    private readonly capsules: CapsulesService,
  ) {}

  // ---------------------------------------------------------------- reads

  /** Hydrate ids (in order) for the caller. Callers must have already filtered `ids` by visibility. */
  async hydrate(me: CurrentUser, ids: string[]): Promise<ApiSummary[]> {
    const rows = await this.repo.loadFull(ids);
    const runningIds = rows.filter((r) => r.kind === 'running').map((r) => r.id);
    const [favorites, editable, visibleCollections, parents, counts, previews] = await Promise.all([
      this.repo.favoriteIds(me.id, ids),
      this.repo.visibleIds(me, ids, 'edit'),
      this.repo.visibleCollectionIds(me, unique(rows.flatMap((r) => r.collections.map((c) => c.collectionId)))),
      // A visible sumaroon implies a visible running summary (summary.access.ts).
      this.repo.parents(unique(rows.flatMap((r) => (r.parentId ? [r.parentId] : [])))),
      this.repo.sumaroonCounts(runningIds, this.repo.visible(me)),
      this.repo.sumaroonPreviews(runningIds, this.repo.visible(me), SUMAROON_PREVIEW),
    ]);
    const parentById = new Map(parents.map((p) => [p.id, p]));
    return rows.map((r) =>
      toApiSummary(r, {
        isFavorite: favorites.has(r.id),
        canEdit: editable.has(r.id),
        visibleCollections,
        parent: r.parentId ? parentById.get(r.parentId) : undefined,
        sumaroonCount: counts.get(r.id),
        sumaroonPreview: previews.get(r.id),
      }),
    );
  }

  parseSearch(query: unknown): SummarySearch {
    return parse(summarySearchSchema, query);
  }

  /** Feed / profile tabs: one page of the requested bucket plus the count of every bucket under the same filters. */
  async search(me: CurrentUser, ownerId: string, f: SummarySearch): Promise<{ summaries: ApiSummary[]; lengths: SummaryLengths }> {
    const owner = await this.users.findById(ownerId);
    if (!owner) throw new NotFoundException();
    const ctx = { ownerId: f.isProfile ? owner.id : me.id, isProfile: f.isProfile };
    const base = and(this.repo.visible(me), ...(await this.filters(f)))!;
    const buckets = Object.fromEntries(BUCKETS.map((b) => [b.toLowerCase(), this.repo.bucketCondition(b, ctx)])) as Record<Lowercase<Bucket>, SQL>;

    const [ids, lengths] = await Promise.all([
      this.repo.pageIds(and(base, this.repo.bucketCondition(f.summarySearch, ctx))!, this.repo.orderBy(f.sort), f.skip, f.limit),
      this.repo.countBy(base, buckets),
    ]);
    return { summaries: await this.hydrate(me, ids), lengths };
  }

  /** Summaries in a collection (the caller must already be allowed to view the collection). */
  async inCollection(me: CurrentUser, collectionId: string, f: SummarySearch): Promise<{ summaries: ApiSummary[]; lengths: SummaryLengths }> {
    const where = and(
      this.repo.visible(me),
      this.repo.bucketCondition('SUMMARY', { ownerId: me.id, isProfile: false }),
      ...(await this.filters({ ...f, collections: [collectionId] })),
    )!;
    const [ids, total] = await Promise.all([this.repo.pageIds(where, this.repo.orderBy(f.sort), f.skip, f.limit), this.repo.count(where)]);
    return { summaries: await this.hydrate(me, ids), lengths: { summary: total, draft: 0, tagged: 0, favorite: 0 } };
  }

  /** Visible published summaries matching `f`. */
  async count(me: CurrentUser, f: SummarySearch): Promise<number> {
    return this.repo.count(
      and(
        this.repo.visible(me),
        this.repo.bucketCondition('SUMMARY', { ownerId: me.id, isProfile: false }),
        ...(await this.filters(f)),
      )!,
    );
  }

  /** The search filters as SQL, with the capsules it names fetched first. */
  private async filters(f: SummarySearch): Promise<SQL[]> {
    return this.repo.filterConditions(f, this.config.timezone, await this.capsules.lookup(capsuleRefs(f)));
  }

  /** Every visible published id matching `f` (Excel export), capped. */
  async searchAllIds(me: CurrentUser, f: SummarySearch, cap: number): Promise<string[]> {
    const where = and(
      this.repo.visible(me),
      this.repo.bucketCondition('SUMMARY', { ownerId: me.id, isProfile: false }),
      ...(await this.filters(f)),
    )!;
    return this.repo.pageIds(where, this.repo.orderBy(f.sort), 0, cap);
  }

  async get(me: CurrentUser, id: string): Promise<ApiSummary> {
    await this.assertVisible(me, id);
    await this.repo.markSeen(id, me.id);
    const [summary] = await this.hydrate(me, [id]);
    return summary;
  }

  /** Dashboard: latest visible published summaries grouped by their first label. */
  async dashboard(me: CurrentUser): Promise<Record<string, ApiSummary[]>> {
    if (!this.auth.inAnyGroup(me, this.config.access.dashboardGroups)) throw new ForbiddenException();
    const rows = await this.repo.latestWithFirstLabel(
      and(this.repo.visible(me), this.repo.bucketCondition('SUMMARY', { ownerId: me.id, isProfile: false }))!,
      DASHBOARD_SCAN,
    );
    const groups = new Map<string, string[]>();
    for (const r of rows) {
      const key = r.label ?? 'ללא תגית';
      const list = groups.get(key) ?? [];
      if (list.length < DASHBOARD_PER_GROUP) groups.set(key, [...list, r.id]);
    }
    const byId = new Map((await this.hydrate(me, [...groups.values()].flat())).map((s) => [s._id, s]));
    return Object.fromEntries([...groups].map(([key, ids]) => [key, ids.map((id) => byId.get(id)!)]));
  }

  async assertVisible(me: CurrentUser, id: string): Promise<void> {
    if (!(await this.repo.visibleIds(me, [id])).has(id)) throw new NotFoundException();
  }

  /** Hidden → 404 (non-disclosing); visible but not an editor → 403. */
  async assertEditable(me: CurrentUser, id: string): Promise<void> {
    await this.assertVisible(me, id);
    if (!(await this.repo.visibleIds(me, [id], 'edit')).has(id)) throw new ForbiddenException();
  }

  /**
   * Splits `ids` into the ones the caller may edit and the rest, with why. Hidden and nonexistent ids are both
   * `not-found` (A7). Bulk writers call this under their row locks.
   */
  async partitionEditable(me: CurrentUser, ids: string[]): Promise<{ editable: string[]; skipped: ApiBulkResult['skipped'] }> {
    const visible = await this.repo.visibleIds(me, ids);
    const editable = await this.repo.visibleIds(me, ids, 'edit');
    return {
      editable: ids.filter((id) => editable.has(id)),
      skipped: ids.filter((id) => !editable.has(id)).map((id) => ({ id, reason: visible.has(id) ? 'not-editor' : 'not-found' })),
    };
  }

  /** Locks `ids` and splits them by edit access, re-checked under the locks (access may have changed since listing). */
  private async lockEditable(me: CurrentUser, ids: string[]): Promise<{ editable: string[]; skipped: ApiBulkResult['skipped'] }> {
    const found = await this.repo.lockManyForUpdate(ids);
    const { editable, skipped } = await this.partitionEditable(
      me,
      ids.filter((id) => found.has(id)),
    );
    skipped.push(...ids.filter((id) => !found.has(id)).map((id) => ({ id, reason: 'not-found' as const })));
    return { editable, skipped };
  }

  // ---------------------------------------------------------------- writes

  async create(me: CurrentUser, rawPayload: unknown, uploads: UploadedFile[]): Promise<ApiSummary> {
    const payload = parse(payloadSchema, rawPayload);
    const input = await this.validate(me, payload);
    let createdId: string | undefined;
    try {
      await this.database.transaction(async () => {
        // Serialize with edits of the running summary (its range or content type may be changing).
        if (input.values.parentId) {
          const parent = await this.repo.lockForUpdate(input.values.parentId);
          if (!parent) throw new BadRequestException('unknown running summary');
          this.assertFitsParent(input.values, parent);
        }
        const id = await this.repo.insert({ ...input.values, createdBy: me.id });
        createdId = id;
        await this.repo.addEditor(id, me.id);
        await this.writeRelations(id, input);
        await this.repo.addCollections(id, input.collectionIds);
        await this.repo.addFiles(id, await this.files.store(id, uploads));
        if (!input.values.isDraft) {
          await this.notifyTagged(me, id, input.values.title, input.taggedUserIds, input.taggedPermissionIds);
          await this.notifications.onPublished(this.published(id, input), me);
        }
      });
    } catch (e) {
      if (createdId) await this.files.removeAll(createdId);
      throw e;
    }
    const [summary] = await this.hydrate(me, [createdId!]);
    return summary;
  }

  async update(me: CurrentUser, rawPayload: unknown, uploads: UploadedFile[]): Promise<ApiSummary> {
    const payload = parse(payloadSchema, rawPayload);
    if (!payload.id) throw new BadRequestException('id is required');
    const id = zId.parse(payload.id);
    await this.assertEditable(me, id);
    const input = await this.validate(me, payload, await this.repo.findById(id));
    let added: string[] = [];

    try {
      await this.database.transaction(async () => {
        const current = await this.repo.lockForUpdate(id);
        if (!current) throw new NotFoundException();
        // Re-check under the row lock: access may have changed since the pre-check.
        await this.assertEditable(me, id);
        const previousTagged = await this.repo.taggedUserIds(id);
        const previousTaggedGroups = await this.repo.taggedPermissionIds(id);
        if (current.kind === 'running') await this.assertSumaroonsStillFit(current, input.values);

        if (!(await this.repo.update(id, input.values, payload.version))) throw new ConflictException('summary was changed by someone else');
        await this.writeRelations(id, input);
        await this.syncCollections(me, id, input.collectionIds);

        const dropped = await this.repo.removeFilesExcept(id, input.keepFiles);
        const stored = await this.files.store(id, uploads);
        added = stored.map((f) => f.fileName);
        await this.repo.addFiles(id, stored);
        const replaced = new Set(added);
        await this.database.afterCommit(() => this.files.remove(id, dropped.filter((n) => !replaced.has(n))));

        if (!input.values.isDraft) {
          const newlyTagged = input.taggedUserIds.filter((u) => current.isDraft || !previousTagged.includes(u));
          const newlyTaggedGroups = input.taggedPermissionIds.filter((p) => current.isDraft || !previousTaggedGroups.includes(p));
          await this.notifyTagged(me, id, input.values.title, newlyTagged, newlyTaggedGroups);
          if (current.isDraft) await this.notifications.onPublished(this.published(id, input), me);
          else await this.notifications.onUpdated(this.published(id, input), me);
        }
      });
    } catch (e) {
      await this.files.remove(id, added);
      throw e;
    }
    const [summary] = await this.hydrate(me, [id]);
    return summary;
  }

  /**
   * Excel bulk import: every row is validated first, then all rows are written in one transaction
   * (all-or-nothing). Imports do not fan out follower/rule notifications.
   */
  async importMany(me: CurrentUser, rawPayloads: unknown[]): Promise<number> {
    const inputs: ValidInput[] = [];
    for (const [i, raw] of rawPayloads.entries()) {
      try {
        inputs.push(await this.validate(me, parse(payloadSchema, raw)));
      } catch (e) {
        if (e instanceof BadRequestException) throw new BadRequestException(`row ${i + 2}: ${(e.getResponse() as { message?: string }).message ?? 'invalid'}`);
        throw e;
      }
    }
    await this.database.transaction(async () => {
      for (const input of inputs) {
        const id = await this.repo.insert({ ...input.values, createdBy: me.id });
        await this.repo.addEditor(id, me.id);
        await this.writeRelations(id, input);
        await this.repo.addCollections(id, input.collectionIds);
      }
    });
    return inputs.length;
  }

  async delete(me: CurrentUser, id: string): Promise<void> {
    await this.database.transaction(async () => {
      if (!(await this.repo.lockForUpdate(id))) throw new NotFoundException();
      await this.assertEditable(me, id);
      // Deleting a running summary deletes its sumaroons (FK cascade), whoever wrote them.
      const sumaroons = await this.repo.sumaroonIds(id);
      await this.repo.delete(id);
      await this.database.afterCommit(async () => {
        for (const sid of [id, ...sumaroons]) await this.files.removeAll(sid);
      });
    });
  }

  /**
   * Add and/or remove labels on many summaries. Applies to every summary the caller may edit and reports the rest.
   * Added labels go after the existing ones, so a summary's first label (dashboard group) only changes if it is removed.
   * Like Excel import, bulk edits do not fan out follower/rule notifications.
   */
  async bulkLabels(me: CurrentUser, body: unknown): Promise<ApiBulkResult> {
    const p = parse(bulkLabelsSchema, body);
    const add = cleanLabels(p.add);
    const remove = new Set(cleanLabels(p.remove));
    if (!add.length && !remove.size) throw new BadRequestException('add or remove at least one label');
    if (add.some((l) => remove.has(l))) throw new BadRequestException('a label cannot be both added and removed');
    const ids = unique(p.summaryIds);

    return this.database.transaction(async () => {
      const { editable, skipped } = await this.lockEditable(me, ids);
      const current = await this.repo.labelNames(editable);
      const labelIds = await this.labels.ensure(unique([...add, ...[...current.values()].flat()]));
      const applied: string[] = [];
      for (const id of editable) {
        const before = current.get(id) ?? [];
        const next = unique([...before.filter((l) => !remove.has(l)), ...add]);
        if (next.length > MAX_LABELS) {
          skipped.push({ id, reason: 'too-many-labels' });
          continue;
        }
        applied.push(id);
        if (next.length === before.length && next.every((l, i) => l === before[i])) continue;
        await this.repo.replaceLabels(
          id,
          next.map((n) => labelIds.get(n)!),
        );
        await this.repo.update(id, {});
      }
      return { applied, skipped };
    });
  }

  /** Card colour is a shared marker any viewer may set (the client shows the picker on every card). */
  /** Like setColor, colour needs only view access: applies to every summary the caller can see. */
  async bulkColor(me: CurrentUser, body: unknown): Promise<ApiBulkResult> {
    const p = parse(bulkColorSchema, body);
    const ids = unique(p.summaryIds);
    return this.database.transaction(async () => {
      const visible = await this.repo.visibleIds(me, ids);
      const applied = ids.filter((id) => visible.has(id));
      for (const id of applied) await this.repo.update(id, { color: p.color });
      return { applied, skipped: ids.filter((id) => !visible.has(id)).map((id) => ({ id, reason: 'not-found' as const })) };
    });
  }

  async bulkToDraft(me: CurrentUser, body: unknown): Promise<ApiBulkResult> {
    const ids = unique(parse(bulkIdsSchema, body).summaryIds);
    return this.database.transaction(async () => {
      const { editable, skipped } = await this.lockEditable(me, ids);
      for (const id of editable) await this.repo.update(id, { isDraft: true });
      return { applied: editable, skipped };
    });
  }

  /** Deletes every summary the caller may edit; a running summary takes its sumaroons with it (as in delete). */
  async bulkDelete(me: CurrentUser, body: unknown): Promise<ApiBulkResult> {
    const ids = unique(parse(bulkIdsSchema, body).summaryIds);
    return this.database.transaction(async () => {
      const { editable, skipped } = await this.lockEditable(me, ids);
      const gone: string[] = [];
      for (const id of editable) {
        gone.push(id, ...(await this.repo.sumaroonIds(id)));
        await this.repo.delete(id);
      }
      await this.database.afterCommit(async () => {
        for (const sid of unique(gone)) await this.files.removeAll(sid);
      });
      return { applied: editable, skipped };
    });
  }

  async setColor(me: CurrentUser, id: string, color: unknown): Promise<void> {
    if (typeof color !== 'string' || !COLOR_RE.test(color)) throw new BadRequestException('invalid color');
    await this.assertVisible(me, id);
    await this.repo.update(id, { color });
  }

  async toDraft(me: CurrentUser, id: string): Promise<void> {
    await this.assertEditable(me, id);
    await this.repo.update(id, { isDraft: true });
  }

  async setTimelineTitle(me: CurrentUser, id: string, title: unknown): Promise<void> {
    if (typeof title !== 'string' || title.length > 200) throw new BadRequestException('invalid timeline title');
    await this.assertEditable(me, id);
    await this.repo.update(id, { timelineTitle: title.trim() || null });
  }

  async attachment(me: CurrentUser, id: string, fileName: string) {
    await this.assertVisible(me, id);
    const meta = await this.repo.file(id, fileName);
    if (!meta) throw new NotFoundException();
    return { meta, stream: this.files.open(id, fileName) };
  }

  /** For collections/folders: which of `ids` are sumaroons (they cannot be placed anywhere but their running summary). */
  onlySumaroons(ids: string[]): Promise<string[]> {
    return this.repo.onlySumaroons(ids);
  }

  // ---------------------------------------------------------------- helpers

  /** A sumaroon uses its running summary's content type and must be dated inside its range. */
  private assertFitsParent(v: Pick<SummaryValues, 'contentTypeId' | 'eventDate'>, parent: SummaryRow): void {
    if (parent.kind !== 'running') throw new BadRequestException('parent must be a running summary');
    if (v.contentTypeId !== parent.contentTypeId) throw new BadRequestException("a sumaroon uses its running summary's content type");
    const [from, to] = calendarDayRange(parent.rangeStart!, parent.rangeEnd!, this.config.timezone);
    if (!v.eventDate || v.eventDate < from || v.eventDate > to) throw new BadRequestException("a sumaroon's date must be inside its running summary's range");
  }

  /** Editing a running summary must not strand its sumaroons: content type is locked while it has any; the range must still cover them. */
  private async assertSumaroonsStillFit(current: SummaryRow, next: Partial<SummaryValues>): Promise<void> {
    if (!(await this.repo.sumaroonIds(current.id)).length) return;
    if (next.contentTypeId !== current.contentTypeId) throw new BadRequestException('the content type of a running summary with sumaroons cannot change');
    if (next.rangeStart === current.rangeStart && next.rangeEnd === current.rangeEnd) return;
    const [from, to] = calendarDayRange(next.rangeStart!, next.rangeEnd!, this.config.timezone);
    if (await this.repo.sumaroonsOutside(current.id, from, to)) throw new BadRequestException('some sumaroons fall outside the new range');
  }

  private async writeRelations(id: string, input: ValidInput): Promise<void> {
    const labelIds = await this.labels.ensure(input.labelNames);
    await this.repo.replacePermissions(id, input.permissionIds);
    await this.repo.replaceLabels(
      id,
      input.labelNames.map((n) => labelIds.get(n)!),
    );
    await this.repo.replaceFields(id, input.fieldValues);
    await this.repo.replaceTagged(id, input.taggedUserIds);
    await this.repo.replaceTaggedPermissions(id, input.taggedPermissionIds);
  }

  /**
   * Replace memberships within the collections the editor can see. Memberships in collections hidden from the
   * editor are left untouched (the client never received them, so their absence is not a removal request).
   */
  private async syncCollections(me: CurrentUser, id: string, desired: string[]): Promise<void> {
    const current = await this.repo.collectionIds(id);
    const visible = await this.repo.visibleCollectionIds(me, current);
    await this.repo.removeCollections(
      id,
      current.filter((c) => visible.has(c) && !desired.includes(c)),
    );
    await this.repo.addCollections(
      id,
      desired.filter((c) => !current.includes(c)),
    );
  }

  /** Tagged users, then members of tagged groups who weren't tagged by name: one notification each. */
  private async notifyTagged(me: CurrentUser, id: string, title: string, userIds: string[], permissionIds: string[]): Promise<void> {
    const n = { summaryId: id, createdBy: me.id };
    await this.notifications.notify(userIds, { ...n, text: `${me.fullName} תייג/ה אותך בתמצית "${title}"` });
    await this.notifications.notifyGroups(permissionIds, n, (group) => `${me.fullName} תייג/ה את "${group}" בתמצית "${title}"`, userIds);
  }

  /** What notification rules are checked against (inside the write's transaction, so the saved row is what matches). */
  private published(id: string, input: ValidInput) {
    return {
      id,
      title: input.values.title,
      fieldValues: this.fieldMap(input),
      matchesSearch: async (search: Record<string, unknown>) => {
        const f = summarySearchSchema.safeParse(search);
        return f.success && (await this.repo.count(and(eq(summaries.id, id), ...(await this.filters(f.data)))!)) > 0;
      },
    };
  }

  /** Field values for rule matching, plus the summary's own text under SUMMARY_TEXT_FIELD. */
  private fieldMap(input: ValidInput): Map<string, string> {
    const { title, contentText, notesText } = input.values;
    const text = [title, contentText, notesText].filter(Boolean).join('\n');
    return new Map([...input.fieldValues.map((f): [string, string] => [f.fieldId, f.value]), [SUMMARY_TEXT_FIELD._id, text]]);
  }

  /** Everything the database cannot check by itself: references, field types, and who may assign what. */
  private async validate(me: CurrentUser, p: Payload, existing?: SummaryRow): Promise<ValidInput> {
    const contentType = await this.contentTypes.contentType(p.contentType);
    if (!contentType) throw new BadRequestException('unknown content type');

    const parentId = p.parentId ?? null;
    if (existing && (existing.kind !== p.kind || existing.parentId !== parentId)) throw new BadRequestException('kind and running summary cannot change');
    const isSumaroon = p.kind === 'sumaroon';
    if (isSumaroon !== !!parentId) throw new BadRequestException('a sumaroon needs a running summary (and only a sumaroon has one)');
    if (p.kind === 'running' ? !p.rangeStart || !p.rangeEnd || p.rangeStart > p.rangeEnd : p.rangeStart || p.rangeEnd)
      throw new BadRequestException('a running summary needs a date range (rangeStart ≤ rangeEnd); other kinds have none');
    if (!isSumaroon && p.link) throw new BadRequestException('only a sumaroon has a link');
    let parent: SummaryRow | undefined;
    if (parentId) {
      // Like adding a summary to a collection: you need to see the running summary.
      if (!(await this.repo.visibleIds(me, [parentId])).has(parentId)) throw new BadRequestException('unknown running summary');
      parent = await this.repo.findById(parentId);
    }

    // A sumaroon inherits its running summary's permissions, so its own are optional extras; drafts may have none.
    const permissionIds = await validPermissionSet(this.permissions, me, p.permissions, { required: !p.isDraft && !isSumaroon, what: 'a published summary' });

    const labelNames = cleanLabels(p.labels);

    const lastByField = new Map(p.summaryFields.map((f) => [f.field, f.value.trim()]));
    const defs = new Map((await this.contentTypes.fieldsByIds([...lastByField.keys()])).map((f) => [f.id, f]));
    const fieldValues = [...lastByField]
      .filter(([, value]) => value !== '')
      .map(([fieldId, value]) => {
        const def = defs.get(fieldId);
        if (!def) throw new BadRequestException(`unknown field ${fieldId}`);
        return { fieldId, value: validateFieldValue(def, value) };
      });
    if (!p.isDraft) {
      const missing = contentType.fields.filter((f) => f.required && !fieldValues.some((v) => v.fieldId === f.fieldId));
      if (missing.length) throw new BadRequestException('required content-type fields are missing');
    }

    const taggedUserIds = unique(p.taggedUsers);
    if ((await this.users.existingIds(taggedUserIds)).length !== taggedUserIds.length) throw new BadRequestException('unknown tagged user');
    // Any group may be tagged (unlike viewing permissions); only members who can see the summary are notified.
    const taggedPermissionIds = unique(p.taggedPermissions);
    if ((await this.permissions.byIds(taggedPermissionIds)).length !== taggedPermissionIds.length) throw new BadRequestException('unknown tagged group');

    const collectionIds = unique(p.collectionIds);
    if (isSumaroon && collectionIds.length) throw new BadRequestException(SUMAROON_ONLY_INSIDE);
    const visibleCollections = await this.repo.visibleCollectionIds(me, collectionIds);
    if (collectionIds.some((c) => !visibleCollections.has(c))) throw new BadRequestException('unknown collection');

    let eventDate: Date | null = null;
    if (p.eventDate) {
      eventDate = parseEventDate(p.eventDate, p.eventSecTime ?? undefined, this.config.timezone);
      if (!eventDate) throw new BadRequestException('eventDate must be yyyy-MM-dd and eventSecTime HH:mm');
    }

    if (parent) this.assertFitsParent({ contentTypeId: contentType.id, eventDate }, parent);

    const contentHtml = sanitizeQuill(p.contentHtml);
    const notesHtml = sanitizeQuill(p.notesHtml);
    return {
      values: {
        title: p.title,
        contentHtml,
        contentText: htmlToText(contentHtml),
        notesHtml,
        notesText: htmlToText(notesHtml),
        department: p.department,
        contentTypeId: contentType.id,
        isDraft: p.isDraft,
        eventDate,
        eventHasTime: !!(eventDate && p.eventSecTime),
        kind: p.kind,
        parentId,
        rangeStart: p.kind === 'running' ? p.rangeStart! : null,
        rangeEnd: p.kind === 'running' ? p.rangeEnd! : null,
        link: isSumaroon ? p.link || null : null,
      },
      permissionIds,
      labelNames,
      fieldValues,
      taggedUserIds,
      taggedPermissionIds,
      collectionIds,
      keepFiles: unique(p.files),
    };
  }
}

/** Trimmed, non-empty, distinct label names within the length limit. */
function cleanLabels(names: string[]): string[] {
  const out = unique(names.map((l) => l.trim()).filter(Boolean));
  if (out.some((l) => l.length > MAX_LABEL)) throw new BadRequestException(`labels are limited to ${MAX_LABEL} characters`);
  return out;
}

/** Runtime check of a custom-field value against its definition; returns the normalized stored text. */
export function validateFieldValue(def: Pick<FieldRow, 'name' | 'type'>, value: string): string {
  const bad = () => new BadRequestException(`invalid value for field "${def.name}"`);
  if (value.length > 5000) throw bad();
  switch (def.type as FieldType) {
    case 'number':
      if (!Number.isFinite(Number(value))) throw bad();
      return String(Number(value));
    case 'date': {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) throw bad();
      return d.toISOString();
    }
    case 'hour':
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw bad();
      return value;
    default:
      return value;
  }
}
