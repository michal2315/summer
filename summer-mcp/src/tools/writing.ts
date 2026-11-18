import { z } from 'zod';
import { ApiBulkResult, ApiQuery, ApiSummary, UserRef } from '../api-types';
import { localDay, localTime, summaryBrief, toHtml } from '../format';
import { queryFiltersShape, sortSchema, toSummerSearch } from '../search';
import { SummerApi } from '../summer-api';
import { defineTool, ToolContext, ToolInputError } from '../tool';
import { findQuery, queryOut } from './watching';

const id = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use yyyy-MM-dd');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use HH:mm');
const fieldValues = z
  .array(z.object({ fieldId: id, value: z.union([z.string(), z.number()]) }))
  .max(200)
  .describe("Values for the content type's fields (field ids from get_catalog).");

/** The SummaryPayload summer-server takes on POST / PUT /summary. */
interface SummaryPayload {
  id?: string;
  title: string;
  contentHtml: string;
  notesHtml: string;
  contentType: string;
  eventDate?: string | null;
  eventSecTime?: string | null;
  department: string;
  labels: string[];
  folderIds?: string[];
  permissions: string[];
  taggedUsers: string[];
  taggedPermissions: string[];
  summaryFields: { field: string; value: string }[];
  files: string[];
  isDraft: boolean;
  kind: ApiSummary['kind'];
  parentId?: string | null;
  rangeStart?: string | null;
  rangeEnd?: string | null;
  link?: string | null;
}

/** An existing summary as the payload that would save it unchanged (folders left as they are). */
function payloadOf(s: ApiSummary): SummaryPayload {
  return {
    id: s._id,
    title: s.title,
    contentHtml: s.content,
    notesHtml: s.notes,
    contentType: s.contentType._id,
    eventDate: s.eventDate ? localDay(s.eventDate) : null,
    eventSecTime: s.eventDate && s.eventSecTime ? localTime(s.eventDate) : null,
    department: s.department,
    labels: s.labels.map((l) => l.name),
    permissions: s.permissions.map((p) => p._id),
    taggedUsers: s.taggedUsers.map((u) => u._id),
    taggedPermissions: s.taggedPermissions.map((p) => p._id),
    summaryFields: s.summaryFields.map((f) => ({ field: f.field._id, value: f.value })),
    files: s.files,
    isDraft: s.isDraft,
    kind: s.kind,
    parentId: s.parentId ?? null,
    rangeStart: s.rangeStart ?? null,
    rangeEnd: s.rangeEnd ?? null,
    link: s.link ?? null,
  };
}

const getSummary = (api: SummerApi, summaryId: string) => api.get<ApiSummary>(`/summary/${summaryId}/false`);

export function registerWritingTools(ctx: ToolContext): void {
  defineTool(
    ctx,
    'create_summary',
    {
      title: 'Create summary',
      description:
        'Writes a new summary. It is saved as a draft unless `publish` is true. ' +
        'Kinds: summary (regular), running (a running summary over a date range: needs rangeStart and rangeEnd) and sumaroon ' +
        '(an entry inside a running summary: needs runningSummaryId and an eventDate inside its range; it takes the running ' +
        "summary's content type and inherits its permissions). " +
        'Every summary except a sumaroon needs at least one permission group, and only groups you belong to ' +
        '(get_catalog → myPermissionGroups). Publishing needs the content type\'s required fields (get_catalog: required) filled in. ' +
        'Drafts and sumaroons cannot be put in folders.',
      input: {
        title: z.string().min(1).max(300),
        content: z.string().describe('The body. Plain text (one paragraph per line) or HTML.'),
        notes: z.string().optional().describe('Notes, plain text or HTML.'),
        kind: z.enum(['summary', 'running', 'sumaroon']).optional().describe('Default: summary.'),
        runningSummaryId: id.optional().describe('sumaroon only: the running summary it goes into.'),
        contentTypeId: id.optional().describe('Content type id (get_catalog). Required except for a sumaroon.'),
        eventDate: day.optional().describe('When it happened (yyyy-MM-dd).'),
        eventTime: time.optional().describe('Time of the event (HH:mm), with eventDate.'),
        rangeStart: day.optional().describe('running only: first day of the range.'),
        rangeEnd: day.optional().describe('running only: last day of the range.'),
        link: z.string().url().optional().describe('sumaroon only: source link (http/https).'),
        department: z.string().max(200).optional(),
        labels: z.array(z.string()).max(50).optional().describe('Label names. New names create new labels.'),
        permissionIds: z.array(id).max(100).optional().describe('Permission groups that may see it. Required except for a sumaroon.'),
        taggedUserIds: z.array(id).max(200).optional().describe('Users to tag (they get notified when it is published).'),
        taggedPermissionIds: z.array(id).max(100).optional().describe('Permission groups whose members count as tagged.'),
        fields: fieldValues.optional(),
        folderIds: z.array(id).max(50).optional().describe('Folders to place it in (published regular / running summaries only; you must manage the folder).'),
        publish: z.boolean().optional().describe('true publishes it right away. Default: false (saved as a draft).'),
      },
      write: { destructive: false },
    },
    async (a, api) => {
      const kind = a.kind ?? 'summary';
      if (kind === 'sumaroon' && !a.runningSummaryId) throw new ToolInputError('A sumaroon needs runningSummaryId.');
      if (kind !== 'sumaroon' && a.runningSummaryId) throw new ToolInputError('Only a sumaroon goes into a running summary; set kind to "sumaroon".');
      if (kind !== 'sumaroon' && !a.permissionIds?.length)
        throw new ToolInputError('A summary needs at least one permission group (permissionIds). Ask the user which groups may see it; get_catalog lists myPermissionGroups.');

      let contentType = a.contentTypeId;
      if (kind === 'sumaroon') contentType = (await getSummary(api, a.runningSummaryId!)).contentType._id;
      if (!contentType) throw new ToolInputError('contentTypeId is required (get_catalog lists content types).');

      const payload: SummaryPayload = {
        title: a.title,
        contentHtml: toHtml(a.content),
        notesHtml: a.notes ? toHtml(a.notes) : '',
        contentType,
        eventDate: a.eventDate ?? null,
        eventSecTime: a.eventDate && a.eventTime ? a.eventTime : null,
        department: a.department ?? '',
        labels: a.labels ?? [],
        folderIds: a.folderIds,
        permissions: a.permissionIds ?? [],
        taggedUsers: a.taggedUserIds ?? [],
        taggedPermissions: a.taggedPermissionIds ?? [],
        summaryFields: (a.fields ?? []).map((f) => ({ field: f.fieldId, value: String(f.value) })),
        files: [],
        isDraft: !a.publish,
        kind,
        parentId: a.runningSummaryId ?? null,
        rangeStart: a.rangeStart ?? null,
        rangeEnd: a.rangeEnd ?? null,
        link: a.link ?? null,
      };
      const created = await api.summary<ApiSummary>('POST', payload);
      return { created: summaryBrief(created), status: created.isDraft ? 'draft' : 'published' };
    },
  );

  defineTool(
    ctx,
    'update_summary',
    {
      title: 'Update summary',
      description:
        'Changes some fields of a summary you can edit; everything you leave out stays as it is. ' +
        'List fields you pass (labels, permissionIds, taggedUserIds, folderIds…) replace the current list, so include the ones to keep. ' +
        '`fields` only sets the fields you pass. `publish: true` publishes a draft; the content type\'s required fields must be filled by then.',
      input: {
        id: id.describe('The summary to change.'),
        title: z.string().min(1).max(300).optional(),
        content: z.string().optional().describe('New body, plain text or HTML. Replaces the whole body.'),
        notes: z.string().optional().describe('New notes, plain text or HTML. Replaces the notes.'),
        contentTypeId: id.optional(),
        eventDate: day.nullable().optional().describe('yyyy-MM-dd, or null to clear.'),
        eventTime: time.nullable().optional().describe('HH:mm, or null for no time.'),
        rangeStart: day.optional().describe('running only.'),
        rangeEnd: day.optional().describe('running only.'),
        link: z.string().url().nullable().optional().describe('sumaroon only.'),
        department: z.string().max(200).optional(),
        labels: z.array(z.string()).max(50).optional().describe('Replaces the labels. For adding or removing a few, bulk_labels is simpler.'),
        permissionIds: z.array(id).max(100).optional().describe('Replaces the permission groups.'),
        taggedUserIds: z.array(id).max(200).optional().describe('Replaces the tagged users.'),
        taggedPermissionIds: z.array(id).max(100).optional().describe('Replaces the tagged groups.'),
        fields: fieldValues.optional().describe('Sets these field values; other fields keep theirs. An empty value clears a field.'),
        folderIds: z.array(id).max(50).optional().describe('Replaces the folders it is in ([] takes it out of all of them).'),
        publish: z.boolean().optional().describe('true publishes a draft.'),
      },
      write: { destructive: true, idempotent: true },
    },
    async (a, api) => {
      const current = await getSummary(api, a.id);
      if (!current.canEdit) throw new ToolInputError('You cannot edit this summary.');
      const p = payloadOf(current);

      if (a.title !== undefined) p.title = a.title;
      if (a.content !== undefined) p.contentHtml = toHtml(a.content);
      if (a.notes !== undefined) p.notesHtml = toHtml(a.notes);
      if (a.contentTypeId !== undefined) p.contentType = a.contentTypeId;
      if (a.eventDate !== undefined) p.eventDate = a.eventDate;
      if (a.eventTime !== undefined) p.eventSecTime = a.eventTime;
      if (!p.eventDate) p.eventSecTime = null;
      if (a.rangeStart !== undefined) p.rangeStart = a.rangeStart;
      if (a.rangeEnd !== undefined) p.rangeEnd = a.rangeEnd;
      if (a.link !== undefined) p.link = a.link;
      if (a.department !== undefined) p.department = a.department;
      if (a.labels !== undefined) p.labels = a.labels;
      if (a.permissionIds !== undefined) p.permissions = a.permissionIds;
      if (a.taggedUserIds !== undefined) p.taggedUsers = a.taggedUserIds;
      if (a.taggedPermissionIds !== undefined) p.taggedPermissions = a.taggedPermissionIds;
      if (a.folderIds !== undefined) p.folderIds = a.folderIds;
      if (a.fields?.length) {
        const values = new Map(p.summaryFields.map((f) => [f.field, f.value]));
        for (const f of a.fields) values.set(f.fieldId, String(f.value));
        p.summaryFields = [...values].map(([field, value]) => ({ field, value }));
      }
      if (a.publish) p.isDraft = false;
      if (p.kind !== 'sumaroon' && !p.permissions.length) throw new ToolInputError('A summary needs at least one permission group.');

      const updated = await api.summary<ApiSummary>('PUT', p);
      return { updated: summaryBrief(updated), status: updated.isDraft ? 'draft' : 'published' };
    },
  );

  defineTool(
    ctx,
    'bulk_labels',
    {
      title: 'Add or remove labels',
      description: 'Adds and/or removes labels on many summaries at once. Reports which summaries changed and which were skipped, and why.',
      input: {
        summaryIds: z.array(id).min(1).max(500),
        add: z.array(z.string()).max(50).optional().describe('Label names to add.'),
        remove: z.array(z.string()).max(50).optional().describe('Label names to remove.'),
      },
      write: { destructive: true, idempotent: true },
    },
    async ({ summaryIds, add, remove }, api) => {
      if (!add?.length && !remove?.length) throw new ToolInputError('Pass labels to add or remove.');
      return api.post<ApiBulkResult>('/summary/bulk/labels', { summaryIds, add: add ?? [], remove: remove ?? [] });
    },
  );

  defineTool(
    ctx,
    'file_summaries',
    {
      title: 'Put summaries in folders',
      description:
        'add: places summaries in a folder (they stay in their other folders). remove: takes them out of a folder. ' +
        'move: from one folder to another. You must manage the folders (list_folders: youManage) and be able to edit the summaries; ' +
        'drafts and sumaroons cannot be placed.',
      input: {
        action: z.enum(['add', 'remove', 'move']),
        summaryIds: z.array(id).min(1).max(500),
        folderId: id.describe('add / remove: the folder. move: the folder to move to.'),
        fromFolderId: id.optional().describe('move only: the folder to take them out of.'),
      },
      write: { destructive: true, idempotent: true },
    },
    async ({ action, summaryIds, folderId, fromFolderId }, api) => {
      if (action === 'remove') {
        await api.post(`/folder/${folderId}/items/remove`, { summaryIds });
        return { removed: summaryIds };
      }
      if (action === 'move' && !fromFolderId) throw new ToolInputError('move needs fromFolderId.');
      const added = await api.post<ApiBulkResult>(`/folder/${folderId}/items`, { summaryIds, partial: true });
      if (action === 'add') return added;
      if (added.applied.length) await api.post(`/folder/${fromFolderId}/items/remove`, { summaryIds: added.applied });
      return { moved: added.applied, skipped: added.skipped };
    },
  );

  defineTool(
    ctx,
    'add_comment',
    {
      title: 'Add comment',
      description: 'Adds a comment to a summary. Mentioned users are notified.',
      input: {
        summaryId: id,
        content: z.string().min(1).max(5000),
        mentionUserIds: z.array(id).max(50).optional().describe('Users to mention (ids from find_users).'),
      },
      write: { destructive: false },
    },
    async ({ summaryId, content, mentionUserIds }, api) => {
      const users = mentionUserIds?.length ? await api.get<UserRef[]>('/user/ids', { _ids: mentionUserIds.join(',') }) : [];
      const mentions = users.map((u) => ({ _id: u._id, type: 'user' as const, value: u.fullName }));
      const mentionText = mentions.filter((m) => !content.includes(`@${m.value}`)).map((m) => `@${m.value}`);
      const text = mentionText.length ? `${content} ${mentionText.join(' ')}` : content;
      const comment = await api.put<{ _id: string }>('/comment', { summaryId, content: text, mentions });
      return { commentId: comment._id, mentioned: mentions.map((m) => m.value) };
    },
  );

  defineTool(
    ctx,
    'save_query',
    {
      title: 'Save query',
      description:
        'Saves a search as a query, optionally with an alert that notifies you about new summaries it finds. ' +
        'Filters are the same as search_summaries, minus department, unfiledOnly, kinds and runningSummaryId (queries do not keep those).',
      input: {
        name: z.string().min(1).max(120),
        ...queryFiltersShape,
        sort: sortSchema.optional(),
        isShared: z.boolean().optional().describe('Others can find, run, copy and alert on it. Default false.'),
        isFavorite: z.boolean().optional(),
        alert: z
          .object({
            mail: z.boolean().optional().describe('Also by e-mail.'),
            digest: z.boolean().optional().describe('One daily digest instead of one notification per summary.'),
          })
          .optional()
          .describe('Pass to alert on it right away.'),
      },
      write: { destructive: false },
    },
    async ({ name, sort, isShared, isFavorite, alert, ...filters }, api) => {
      const search: Record<string, unknown> = { ...toSummerSearch(filters), ...(sort ? { sort } : {}) };
      const query = await api.post<ApiQuery>('/queries', {
        name,
        kind: search.query ? 'advanced' : 'simple',
        search,
        isShared: isShared ?? false,
        isFavorite: isFavorite ?? false,
        alert: alert ? { isActive: true, isMail: alert.mail ?? false, isDigest: alert.digest ?? false } : undefined,
      });
      return queryOut(query);
    },
  );

  defineTool(
    ctx,
    'update_query',
    {
      title: 'Update query',
      description: 'Renames one of your queries, shares / unshares it, (un)favourites it, or replaces its search. To replace the search, pass `replaceSearch` with the full new filters.',
      input: {
        queryId: id,
        name: z.string().min(1).max(120).optional(),
        isShared: z.boolean().optional(),
        isFavorite: z.boolean().optional(),
        replaceSearch: z.object({ ...queryFiltersShape, sort: sortSchema.optional() }).optional().describe('The full new search (replaces the old one).'),
      },
      write: { destructive: true, idempotent: true },
    },
    async ({ queryId, name, isShared, isFavorite, replaceSearch }, api) => {
      let search: Record<string, unknown> | undefined;
      if (replaceSearch) {
        const { sort, ...filters } = replaceSearch;
        search = { ...toSummerSearch(filters), ...(sort ? { sort } : {}) };
      }
      const query = await api.put<ApiQuery>(`/queries/${queryId}`, {
        name,
        isShared,
        isFavorite,
        search,
        kind: search ? (search.query ? 'advanced' : 'simple') : undefined,
      });
      return queryOut(query);
    },
  );

  defineTool(
    ctx,
    'set_alert',
    {
      title: 'Set alert',
      description: 'Your alert on a query (yours or a shared one). on: alert (create or resume). pause: keep it but stop alerting. remove: delete your alert.',
      input: {
        queryId: id,
        action: z.enum(['on', 'pause', 'remove']),
        mail: z.boolean().optional().describe('on only: also by e-mail.'),
        digest: z.boolean().optional().describe('on only: one daily digest instead of one notification per summary.'),
      },
      write: { destructive: true, idempotent: true },
    },
    async ({ queryId, action, mail, digest }, api) => {
      await findQuery(api, queryId);
      const query =
        action === 'remove'
          ? await api.delete<ApiQuery>(`/queries/${queryId}/alert`)
          : await api.put<ApiQuery>(`/queries/${queryId}/alert`, action === 'pause' ? { isActive: false } : { isActive: true, isMail: mail, isDigest: digest });
      return queryOut(query);
    },
  );

  defineTool(
    ctx,
    'mark_notifications_viewed',
    {
      title: 'Mark notifications viewed',
      description: 'Marks one notification as viewed, or all of them when no id is given.',
      input: { notificationId: id.optional() },
      write: { destructive: false, idempotent: true },
    },
    async ({ notificationId }, api) => {
      await api.put(notificationId ? `/notifications/viewed/${notificationId}` : '/notifications/all-viewed');
      return { ok: true, marked: notificationId ?? 'all' };
    },
  );
}
