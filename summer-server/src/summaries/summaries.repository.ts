import { Injectable } from '@nestjs/common';
import { SQL, and, asc, eq, exists, gte, inArray, lte, not, notInArray, or, sql } from 'drizzle-orm';
import { CurrentUser } from '../auth/identity-provider';
import { Capsule, CapsuleLookup, NO_CAPSULES, capsuleTokenId, isCapsuleToken, wordsOf } from '../capsules/capsule';
import { idsWhere, textLike, uuidArray } from '../common/sql';
import { dayRange } from '../common/time';
import { DatabaseService } from '../database/database.service';
import {
  comments,
  folderSummaries,
  folders,
  contentTypes,
  labels,
  permissions,
  summaries,
  summaryEditors,
  summaryFields,
  summaryFiles,
  summaryLabels,
  summaryPermissions,
  summarySeen,
  summaryTaggedPermissions,
  summaryTaggedUsers,
  userFavSummaries,
  users,
} from '../database/schema';
import { folderEditable, folderVisible } from '../folders/folder.access';
import { summaryEditable, summaryVisible } from './summary.access';
import { Bucket, QueryCondition, QueryGroup, SummarySearch, TEXT_FIELDS, TextField, parseQuery } from './summary-search';

const ALL_TEXT_FIELDS: TextField[] = TEXT_FIELDS.filter((f) => f !== 'text');
/** The basic search's "search in" checkboxes. */
const SEARCH_TYPE_FIELDS: Partial<Record<SummarySearch['searchTypes'][number], TextField>> = { TITLE: 'title', CONTENT: 'content', NOTES: 'notes', LABEL: 'labels', COMMENTS: 'comments' };

export type SummaryRow = typeof summaries.$inferSelect;
export type SummaryValues = Omit<typeof summaries.$inferInsert, 'id' | 'createdAt' | 'updatedAt' | 'version'>;

/** NULL-safe negation: a summary with no match must count as "not matching", never as unknown. */
const notTrue = (cond: SQL) => sql`not coalesce(${cond}, false)`;

const refColumns = { id: true, username: true, fullName: true, department: true, isSystem: true } as const;

/** Ownership context for bucket filters: whose drafts/tags/favourites (the profile owner, or the caller). */
export interface BucketOwner {
  ownerId: string;
  isProfile: boolean;
}

@Injectable()
export class SummariesRepository {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  // ---------------------------------------------------------------- access

  /** "The caller may see this summary" as a predicate over `summaries` (see summary.access.ts). */
  visible(me: CurrentUser): SQL {
    return summaryVisible(me);
  }

  editable(me: CurrentUser): SQL {
    return summaryEditable(me);
  }

  /** The subset of `ids` the caller may view (or edit). */
  visibleIds(me: CurrentUser, ids: string[], mode: 'view' | 'edit' = 'view'): Promise<Set<string>> {
    return idsWhere(this.db, summaries, summaries.id, ids, mode === 'view' ? this.visible(me) : this.editable(me));
  }

  /** The subset of folder `ids` the caller may see (a summary's folder is shown only to those who can see the folder). */
  visibleFolderIds(me: CurrentUser, ids: string[], mode: 'view' | 'edit' = 'view'): Promise<Set<string>> {
    return idsWhere(this.db, folders, folders.id, ids, mode === 'view' ? folderVisible(me) : folderEditable(me));
  }

  // ---------------------------------------------------------------- reads

  /** Visible summaries whose custom field `fieldId` equals `value` (`GET /field/summaries`). */
  byField(me: CurrentUser, fieldId: string, value: string): Promise<{ id: string; title: string }[]> {
    return this.db
      .select({ id: summaries.id, title: summaries.title })
      .from(summaryFields)
      .innerJoin(summaries, eq(summaries.id, summaryFields.summaryId))
      .where(and(eq(summaryFields.fieldId, fieldId), eq(summaryFields.value, value), this.visible(me)))
      .orderBy(asc(summaries.title))
      .limit(50);
  }

  async findById(id: string): Promise<SummaryRow | undefined> {
    const [row] = await this.db.select().from(summaries).where(eq(summaries.id, id));
    return row;
  }

  /** Row lock for the duration of the current transaction: serializes edits and permission changes per summary. */
  async lockForUpdate(id: string): Promise<SummaryRow | undefined> {
    const [row] = await this.db.select().from(summaries).where(eq(summaries.id, id)).for('update');
    return row;
  }

  /** Row locks on every existing id in `ids`, taken in id order so concurrent bulk actions cannot deadlock. Returns the ids found. */
  async lockManyForUpdate(ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await this.db.select({ id: summaries.id }).from(summaries).where(inArray(summaries.id, ids)).orderBy(asc(summaries.id)).for('update');
    return new Set(rows.map((r) => r.id));
  }

  /** Search filters shared by the feed, rule matching and Excel export. `capsules`: the ones the search refers to (see capsuleRefs). */
  filterConditions(f: SummarySearch, timeZone: string, capsules: CapsuleLookup = NO_CAPSULES): SQL[] {
    const conds: SQL[] = [];
    const checked = f.searchTypes.flatMap((t) => SEARCH_TYPE_FIELDS[t] ?? []);
    const textFields: TextField[] = checked.length ? checked : ALL_TEXT_FIELDS;

    const query = parseQuery(f.text);
    const anyGroup = query.groups.map((g) =>
      and(
        ...g.map((t) => {
          const capsule = t.capsule ? capsules.byName(t.term) : undefined;
          if (capsule) return t.neg ? notTrue(this.capsuleMatch(capsule, textFields)) : this.capsuleMatch(capsule, textFields);
          const match = this.textMatch(t.term, textFields);
          return match && t.neg ? not(match) : match;
        }),
      ),
    );
    if (anyGroup.length) conds.push(or(...anyGroup)!);
    if (query.users.length)
      conds.push(inArray(summaries.createdBy, this.db.select({ id: users.id }).from(users).where(inArray(sql`lower(${users.username})`, query.users))));
    if (query.contentTypes.length)
      conds.push(
        inArray(
          summaries.contentTypeId,
          this.db
            .select({ id: contentTypes.id })
            .from(contentTypes)
            .where(
              or(
                inArray(sql`lower(${contentTypes.name})`, query.contentTypes.map((t) => t.toLowerCase())),
                inArray(contentTypes.displayName, query.contentTypes),
              ),
            ),
        ),
      );
    const advanced = f.query && this.queryGroup(f.query, timeZone, capsules);
    if (advanced) conds.push(advanced);

    if (f.contentTypes.length)
      conds.push(inArray(summaries.contentTypeId, this.db.select({ id: contentTypes.id }).from(contentTypes).where(inArray(contentTypes.name, f.contentTypes))));
    if (f.colors.length) conds.push(inArray(summaries.color, f.colors));
    if (f.users.length) conds.push(inArray(summaries.createdBy, f.users));
    if (f.department) conds.push(eq(summaries.department, f.department));
    if (f.labels.length)
      conds.push(
        exists(
          this.db
            .select({ x: sql`1` })
            .from(summaryLabels)
            .innerJoin(labels, eq(labels.id, summaryLabels.labelId))
            .where(and(eq(summaryLabels.summaryId, summaries.id), inArray(labels.name, f.labels))),
        ),
      );
    if (f.folders.length) conds.push(this.inFolders(f.folders));
    if (f.noFolder) conds.push(sql`not exists (select 1 from ${folderSummaries} fs where fs.summary_id = coalesce("summaries"."parent_id", "summaries"."id"))`);
    if (f.kinds.length) conds.push(inArray(summaries.kind, f.kinds));
    if (f.parentId) conds.push(eq(summaries.parentId, f.parentId));
    const eventRange = f.dates.length === 2 ? dayRange(f.dates[0], f.dates[1], timeZone) : null;
    if (eventRange) conds.push(and(gte(summaries.eventDate, eventRange[0]), lte(summaries.eventDate, eventRange[1]))!);
    const createdRange = f.createdDates.length === 2 ? dayRange(f.createdDates[0], f.createdDates[1], timeZone) : null;
    if (createdRange) conds.push(and(gte(summaries.createdAt, createdRange[0]), lte(summaries.createdAt, createdRange[1]))!);
    return conds;
  }

  /** `term` appears (case-insensitive substring) in any of `fields`; undefined when no field applies. */
  private textMatch(term: string, fields: readonly TextField[]): SQL | undefined {
    const anyOf: SQL[] = [];
    const has = (f: TextField) => fields.includes('text') || fields.includes(f);
    if (has('title')) anyOf.push(textLike(summaries.title, term));
    if (has('content')) anyOf.push(textLike(summaries.contentText, term));
    if (has('notes')) anyOf.push(textLike(summaries.notesText, term));
    if (has('labels'))
      anyOf.push(
        exists(
          this.db
            .select({ x: sql`1` })
            .from(summaryLabels)
            .innerJoin(labels, eq(labels.id, summaryLabels.labelId))
            .where(and(eq(summaryLabels.summaryId, summaries.id), textLike(labels.name, term))),
        ),
      );
    if (has('comments'))
      anyOf.push(
        exists(
          this.db
            .select({ x: sql`1` })
            .from(comments)
            .where(and(eq(comments.summaryId, summaries.id), textLike(comments.content, term))),
        ),
      );
    return anyOf.length ? or(...anyOf) : undefined;
  }

  /**
   * A capsule over `fields`: every must word, no mustNot word, and — when there are no must words — at least one
   * optional word (capsule.ts). A capsule with nothing to look for matches nothing.
   */
  private capsuleMatch(c: Capsule, fields: readonly TextField[]): SQL {
    const match = (w: string) => this.textMatch(w, fields) ?? sql`false`;
    const must = wordsOf(c, 'must').map(match);
    const optional = wordsOf(c, 'optional').map(match);
    if (!must.length && !optional.length) return sql`false`;
    return and(...must, ...wordsOf(c, 'mustNot').map((w) => notTrue(match(w))), must.length ? undefined : or(...optional))!;
  }

  /** Advanced search tree → SQL. Empty conditions (no words, values or dates) and empty groups are ignored. */
  /**
   * Placed in one of `folderIds` or anywhere below them; a sumaroon counts as wherever its running summary is. Folders
   * do not restrict their items, so this does not check the folders' own visibility (the summary's is checked as usual).
   */
  private inFolders(folderIds: string[]): SQL {
    return sql`exists (select 1 from ${folderSummaries} fs where fs.summary_id = coalesce("summaries"."parent_id", "summaries"."id") and fs.folder_id in (
      with recursive sub(id) as (
        select unnest(${uuidArray(folderIds)})
        union
        select f.id from ${folders} f join sub on f.parent_id = sub.id
      )
      select id from sub))`;
  }

  private queryGroup(g: QueryGroup, timeZone: string, capsules: CapsuleLookup): SQL | undefined {
    const parts = g.children
      .map((c) => (c.type === 'group' ? this.queryGroup(c, timeZone, capsules) : this.queryCondition(c, timeZone, capsules)))
      .filter((c) => !!c);
    if (!parts.length) return undefined;
    return g.op === 'AND' ? and(...parts) : or(...parts);
  }

  private queryCondition(c: QueryCondition, timeZone: string, capsules: CapsuleLookup): SQL | undefined {
    const pick = (cond: SQL) => (c.op === 'isNot' ? notTrue(cond) : cond);

    switch (c.field) {
      case 'text':
      case 'title':
      case 'content':
      case 'notes':
      case 'comments':
      case 'labels': {
        // A capsule counts as one word; one that no longer exists matches nothing.
        const fields = [c.field as TextField];
        const matches = c.words.filter(Boolean).map((w) => {
          if (!isCapsuleToken(w)) return this.textMatch(w, fields)!;
          const capsule = capsules.byId(capsuleTokenId(w));
          return capsule ? this.capsuleMatch(capsule, fields) : sql`false`;
        });
        if (!matches.length) return undefined;
        if (c.op === 'any') return or(...matches);
        if (c.op === 'none') return notTrue(or(...matches)!);
        return and(...matches);
      }
      case 'author':
        return c.values.length ? pick(inArray(summaries.createdBy, c.values)) : undefined;
      case 'contentType':
        return c.values.length
          ? pick(inArray(summaries.contentTypeId, this.db.select({ id: contentTypes.id }).from(contentTypes).where(inArray(contentTypes.name, c.values))))
          : undefined;
      case 'folder':
        return c.values.length ? pick(this.inFolders(c.values)) : undefined;
      case 'color':
        return c.values.length ? pick(inArray(summaries.color, c.values)) : undefined;
      case 'eventDate':
      case 'createdDate': {
        const column = c.field === 'eventDate' ? summaries.eventDate : summaries.createdAt;
        const from = c.op !== 'before' && c.from ? dayRange(c.from, c.from, timeZone)?.[0] : undefined;
        const to = c.op !== 'after' && c.to ? dayRange(c.to, c.to, timeZone)?.[1] : undefined;
        const bounds = [from && gte(column, from), to && lte(column, to)].filter((b) => !!b);
        return bounds.length ? and(...bounds) : undefined;
      }
    }
  }

  bucketCondition(bucket: Bucket, { ownerId, isProfile }: BucketOwner): SQL {
    const published = eq(summaries.isDraft, false);
    switch (bucket) {
      case 'DRAFT':
        return and(eq(summaries.isDraft, true), eq(summaries.createdBy, ownerId))!;
      case 'TAGGED':
        // Tagged by name, or through a tagged group the owner is in (by their last-known groups).
        return and(
          published,
          or(
            exists(
              this.db
                .select({ x: sql`1` })
                .from(summaryTaggedUsers)
                .where(and(eq(summaryTaggedUsers.summaryId, summaries.id), eq(summaryTaggedUsers.userId, ownerId))),
            ),
            exists(
              this.db
                .select({ x: sql`1` })
                .from(summaryTaggedPermissions)
                .innerJoin(permissions, eq(permissions.id, summaryTaggedPermissions.permissionId))
                .innerJoin(users, eq(users.id, ownerId))
                .where(and(eq(summaryTaggedPermissions.summaryId, summaries.id), sql`${permissions.groupName} = any(${users.lastGroupKeys})`)),
            ),
          ),
        )!;
      case 'FAVORITE':
        return exists(
          this.db
            .select({ x: sql`1` })
            .from(userFavSummaries)
            .where(and(eq(userFavSummaries.summaryId, summaries.id), eq(userFavSummaries.userId, ownerId))),
        );
      default:
        return isProfile ? and(published, eq(summaries.createdBy, ownerId))! : published;
    }
  }

  orderBy(sort: SummarySearch['sort']): SQL[] {
    const desc = sort.startsWith('-');
    const column = { eventDate: summaries.eventDate, creationDate: summaries.createdAt, modifyDate: summaries.updatedAt, title: summaries.title }[
      sort.replace('-', '') as 'eventDate'
    ];
    return desc ? [sql`${column} desc nulls last`, sql`${summaries.id} desc`] : [sql`${column} asc nulls last`, sql`${summaries.id} asc`];
  }

  async pageIds(where: SQL, order: SQL[], skip: number, limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ id: summaries.id })
      .from(summaries)
      .where(where)
      .orderBy(...order)
      .offset(skip)
      .limit(limit);
    return rows.map((r) => r.id);
  }

  /**
   * Published summaries within `scope` the caller can see; those matching `search` (scope included) they can't, and per
   * permission they lack how many of the hidden ones require it (a sumaroon also requires its running summary's).
   */
  async accessStats(me: CurrentUser, scope: SQL[], search: SQL[]) {
    const published = eq(summaries.isDraft, false);
    const hiddenWhere = and(published, not(this.visible(me)), ...search)!;
    const hidden = this.db.select({ id: summaries.id, parentId: summaries.parentId }).from(summaries).where(hiddenWhere);
    const [total, hiddenCount, missing] = await Promise.all([
      this.count(and(published, this.visible(me), ...scope)!),
      this.count(hiddenWhere),
      this.db
        .execute<{ permission_id: string; blocking: number; only_one: number }>(
          sql`with hidden as (${hidden}),
            missing as (
              select h.id, array_agg(distinct sp.permission_id) perms
              from hidden h join summary_permissions sp on sp.summary_id = h.id or sp.summary_id = h.parent_id
              where sp.permission_id <> all(${uuidArray(me.permissionIds)})
              group by h.id
            )
            select p as permission_id, count(*)::int as blocking, (count(*) filter (where cardinality(perms) = 1))::int as only_one
            from missing, unnest(perms) p
            group by p
            order by blocking desc`,
        )
        .then((r) => r.rows),
    ]);
    return { total, hidden: hiddenCount, missing };
  }

  async count(where: SQL): Promise<number> {
    const [row] = await this.db.select({ n: sql<number>`count(*)::int` }).from(summaries).where(where);
    return row.n;
  }

  /** Several filtered counts in one scan: `count(*) filter (where …)` per key. */
  async countBy<K extends string>(where: SQL, buckets: Record<K, SQL>): Promise<Record<K, number>> {
    const select = Object.fromEntries(Object.entries<SQL>(buckets).map(([k, cond]) => [k, sql<number>`count(*) filter (where ${cond})::int`]));
    const [row] = await this.db.select(select).from(summaries).where(where);
    return row as Record<K, number>;
  }

  /** Latest visible published summaries with their first label (dashboard grouping). */
  async latestWithFirstLabel(where: SQL, limit: number): Promise<{ id: string; label: string | null }[]> {
    return this.db
      .select({
        id: summaries.id,
        label: sql<string | null>`(select l.name from summary_labels sl join labels l on l.id = sl.label_id
                                   where sl.summary_id = "summaries"."id" order by sl.position limit 1)`,
      })
      .from(summaries)
      .where(where)
      .orderBy(...this.orderBy('-eventDate'))
      .limit(limit);
  }

  /** Everything a summary card/detail needs, loaded as nested JSON per summary (no join row explosion). */
  async loadFull(ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.db.query.summaries.findMany({
      where: (s, { inArray }) => inArray(s.id, ids),
      columns: { contentText: false, notesText: false },
      with: {
        author: { columns: refColumns },
        contentType: { with: { fields: { orderBy: (f, { asc }) => [asc(f.position)] } } },
        permissions: { with: { permission: true } },
        labels: { orderBy: (l, { asc }) => [asc(l.position)], with: { label: { columns: { name: true } } } },
        fields: { with: { field: true } },
        taggedUsers: { with: { user: { columns: refColumns } } },
        taggedPermissions: { with: { permission: true } },
        seen: { columns: { userId: true } },
        files: { columns: { fileName: true }, orderBy: (f, { asc }) => [asc(f.createdAt), asc(f.fileName)] },
        comments: { orderBy: (c, { asc }) => [asc(c.createdAt)], with: { author: { columns: refColumns } } },
        folder: { with: { folder: { columns: { id: true, name: true } } } },
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  }

  /** Running-summary header data shown on each of its sumaroons. */
  async parents(ids: string[]) {
    if (!ids.length) return [];
    return this.db.query.summaries.findMany({
      where: (s, { inArray }) => inArray(s.id, ids),
      columns: { id: true, title: true, rangeStart: true, rangeEnd: true },
      with: {
        permissions: { with: { permission: true } },
        labels: { orderBy: (l, { asc }) => [asc(l.position)], with: { label: { columns: { name: true } } } },
      },
    });
  }

  /** running summary id → number of its published sumaroons passing `visible`. */
  async sumaroonCounts(parentIds: string[], visible: SQL): Promise<Map<string, number>> {
    if (!parentIds.length) return new Map();
    const rows = await this.db
      .select({ parentId: summaries.parentId, n: sql<number>`count(*)::int` })
      .from(summaries)
      .where(and(inArray(summaries.parentId, parentIds), eq(summaries.isDraft, false), visible))
      .groupBy(summaries.parentId);
    return new Map(rows.map((r) => [r.parentId!, r.n]));
  }

  /** running summary id → its first `n` published sumaroons passing `visible`, by event date. */
  async sumaroonPreviews(parentIds: string[], visible: SQL, n: number): Promise<Map<string, { id: string; title: string }[]>> {
    const result = new Map<string, { id: string; title: string }[]>();
    if (!parentIds.length) return result;
    const rows = await this.db
      .select({ id: summaries.id, title: summaries.title, parentId: summaries.parentId })
      .from(summaries)
      .where(and(inArray(summaries.parentId, parentIds), eq(summaries.isDraft, false), visible))
      .orderBy(sql`${summaries.eventDate} asc nulls last`, asc(summaries.id));
    for (const r of rows) {
      const list = result.get(r.parentId!) ?? [];
      if (list.length < n) result.set(r.parentId!, [...list, { id: r.id, title: r.title }]);
    }
    return result;
  }

  /** Every sumaroon of a running summary, regardless of who can see it. */
  async sumaroonIds(parentId: string): Promise<string[]> {
    const rows = await this.db.select({ id: summaries.id }).from(summaries).where(eq(summaries.parentId, parentId));
    return rows.map((r) => r.id);
  }

  /** How many sumaroons of `parentId` have an event date outside [from, to]. */
  async sumaroonsOutside(parentId: string, from: Date, to: Date): Promise<number> {
    return this.count(
      and(eq(summaries.parentId, parentId), or(sql`${summaries.eventDate} is null`, sql`${summaries.eventDate} < ${from}`, sql`${summaries.eventDate} > ${to}`))!,
    );
  }

  /** The subset of `ids` that are sumaroons. */
  async onlySumaroons(ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await this.db
      .select({ id: summaries.id })
      .from(summaries)
      .where(and(inArray(summaries.id, ids), eq(summaries.kind, 'sumaroon')));
    return rows.map((r) => r.id);
  }

  async favoriteIds(userId: string, ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await this.db
      .select({ id: userFavSummaries.summaryId })
      .from(userFavSummaries)
      .where(and(eq(userFavSummaries.userId, userId), inArray(userFavSummaries.summaryId, ids)));
    return new Set(rows.map((r) => r.id));
  }

  async taggedUserIds(id: string): Promise<string[]> {
    const rows = await this.db.select({ id: summaryTaggedUsers.userId }).from(summaryTaggedUsers).where(eq(summaryTaggedUsers.summaryId, id));
    return rows.map((r) => r.id);
  }

  async taggedPermissionIds(id: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: summaryTaggedPermissions.permissionId })
      .from(summaryTaggedPermissions)
      .where(eq(summaryTaggedPermissions.summaryId, id));
    return rows.map((r) => r.id);
  }

  /** summary id → its label names in position order (ids without labels are absent). */
  async labelNames(ids: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (!ids.length) return result;
    const rows = await this.db
      .select({ summaryId: summaryLabels.summaryId, name: labels.name })
      .from(summaryLabels)
      .innerJoin(labels, eq(labels.id, summaryLabels.labelId))
      .where(inArray(summaryLabels.summaryId, ids))
      .orderBy(asc(summaryLabels.position));
    for (const r of rows) result.set(r.summaryId, [...(result.get(r.summaryId) ?? []), r.name]);
    return result;
  }

  /** The folder holding the summary, if any. */
  async folderId(id: string): Promise<string | null> {
    const [row] = await this.db.select({ id: folderSummaries.folderId }).from(folderSummaries).where(eq(folderSummaries.summaryId, id));
    return row?.id ?? null;
  }

  async fileNames(id: string): Promise<string[]> {
    const rows = await this.db.select({ name: summaryFiles.fileName }).from(summaryFiles).where(eq(summaryFiles.summaryId, id));
    return rows.map((r) => r.name);
  }

  async file(id: string, fileName: string) {
    const [row] = await this.db
      .select()
      .from(summaryFiles)
      .where(and(eq(summaryFiles.summaryId, id), eq(summaryFiles.fileName, fileName)));
    return row;
  }

  // ---------------------------------------------------------------- writes (call inside DatabaseService.transaction)

  async insert(values: SummaryValues): Promise<string> {
    const [row] = await this.db.insert(summaries).values(values).returning({ id: summaries.id });
    return row.id;
  }

  /** Bumps version; with `expectedVersion`, updates only if unchanged since the client loaded it (else returns false). */
  async update(id: string, values: Partial<SummaryValues>, expectedVersion?: number): Promise<boolean> {
    const rows = await this.db
      .update(summaries)
      .set({ ...values, updatedAt: new Date(), version: sql`${summaries.version} + 1` })
      .where(expectedVersion === undefined ? eq(summaries.id, id) : and(eq(summaries.id, id), eq(summaries.version, expectedVersion)))
      .returning({ id: summaries.id });
    return rows.length > 0;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(summaries).where(eq(summaries.id, id));
  }

  async addEditor(id: string, userId: string): Promise<void> {
    await this.db.insert(summaryEditors).values({ summaryId: id, userId }).onConflictDoNothing();
  }

  async replacePermissions(id: string, permissionIds: string[]): Promise<void> {
    await this.db.delete(summaryPermissions).where(eq(summaryPermissions.summaryId, id));
    if (permissionIds.length) await this.db.insert(summaryPermissions).values(permissionIds.map((permissionId) => ({ summaryId: id, permissionId })));
  }

  async replaceLabels(id: string, labelIds: string[]): Promise<void> {
    await this.db.delete(summaryLabels).where(eq(summaryLabels.summaryId, id));
    if (labelIds.length) await this.db.insert(summaryLabels).values(labelIds.map((labelId, position) => ({ summaryId: id, labelId, position })));
  }

  async replaceFields(id: string, values: { fieldId: string; value: string }[]): Promise<void> {
    await this.db.delete(summaryFields).where(eq(summaryFields.summaryId, id));
    if (values.length) await this.db.insert(summaryFields).values(values.map((v) => ({ summaryId: id, ...v })));
  }

  async replaceTagged(id: string, userIds: string[]): Promise<void> {
    await this.db.delete(summaryTaggedUsers).where(eq(summaryTaggedUsers.summaryId, id));
    if (userIds.length) await this.db.insert(summaryTaggedUsers).values(userIds.map((userId) => ({ summaryId: id, userId })));
  }

  async replaceTaggedPermissions(id: string, permissionIds: string[]): Promise<void> {
    await this.db.delete(summaryTaggedPermissions).where(eq(summaryTaggedPermissions.summaryId, id));
    if (permissionIds.length) await this.db.insert(summaryTaggedPermissions).values(permissionIds.map((permissionId) => ({ summaryId: id, permissionId })));
  }

  /** Put the summary in `folderId` (moving it out of any other folder), or take it out of the hierarchy with null. */
  async setFolder(id: string, folderId: string | null): Promise<void> {
    if (!folderId) await this.db.delete(folderSummaries).where(eq(folderSummaries.summaryId, id));
    else
      await this.db
        .insert(folderSummaries)
        .values({ summaryId: id, folderId })
        .onConflictDoUpdate({ target: folderSummaries.summaryId, set: { folderId, createdAt: new Date() } });
  }

  async addFiles(id: string, files: { fileName: string; size: number; mimeType: string }[]): Promise<void> {
    if (files.length)
      await this.db
        .insert(summaryFiles)
        .values(files.map((f) => ({ summaryId: id, ...f })))
        .onConflictDoUpdate({
          target: [summaryFiles.summaryId, summaryFiles.fileName],
          set: { size: sql`excluded.size`, mimeType: sql`excluded.mime_type`, createdAt: new Date() },
        });
  }

  /** Drops attachment rows not in `keep`; returns the dropped names. */
  async removeFilesExcept(id: string, keep: string[]): Promise<string[]> {
    const rows = await this.db
      .delete(summaryFiles)
      .where(and(eq(summaryFiles.summaryId, id), keep.length ? notInArray(summaryFiles.fileName, keep) : undefined))
      .returning({ name: summaryFiles.fileName });
    return rows.map((r) => r.name);
  }

  async markSeen(id: string, userId: string): Promise<void> {
    await this.db.insert(summarySeen).values({ summaryId: id, userId }).onConflictDoNothing();
  }

  async editorIds(id: string): Promise<string[]> {
    const rows = await this.db.select({ id: summaryEditors.userId }).from(summaryEditors).where(eq(summaryEditors.summaryId, id)).orderBy(asc(summaryEditors.userId));
    return rows.map((r) => r.id);
  }
}

export type FullSummary = Awaited<ReturnType<SummariesRepository['loadFull']>>[number];
export type ParentSummary = Awaited<ReturnType<SummariesRepository['parents']>>[number];
