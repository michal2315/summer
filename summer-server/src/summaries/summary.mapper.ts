import { ApiSummary, ApiSummaryParent, toApiPermission, toRef } from '../common/api-types';
import { toApiContentType, toApiField } from '../content-types/content-types.repository';
import { FullSummary, ParentSummary } from './summaries.repository';

/**
 * DB aggregate → client ISummary. `visibleFolders` hides the summary's folder when the viewer cannot see it
 * (a folder's name is protected by its own permissions).
 */
export function toApiSummary(
  s: FullSummary,
  ctx: {
    isFavorite: boolean;
    canEdit: boolean;
    visibleFolders: Set<string>;
    parent?: ParentSummary;
    sumaroonCount?: number;
    sumaroonPreview?: { id: string; title: string }[];
  },
): ApiSummary {
  const eventDate = s.eventDate?.toISOString();
  return {
    _id: s.id,
    title: s.title,
    content: s.contentHtml,
    notes: s.notesHtml,
    department: s.department,
    user: toRef(s.author),
    isDraft: s.isDraft,
    creationDate: s.createdAt.toISOString(),
    modifyDate: s.updatedAt.toISOString(),
    eventDate,
    eventSecTime: s.eventHasTime ? eventDate : undefined,
    contentType: toApiContentType(s.contentType),
    labels: s.labels.map((l) => ({ name: l.label.name })),
    comments: s.comments.map((c) => ({
      _id: c.id,
      content: c.content,
      mentions: c.mentions,
      user: toRef(c.author),
      creationDate: c.createdAt.toISOString(),
    })),
    summaryFields: s.fields.map((f) => ({ _id: f.fieldId, field: toApiField(f.field), value: f.value })),
    files: s.files.map((f) => f.fileName),
    taggedUsers: s.taggedUsers.map((t) => toRef(t.user)),
    taggedPermissions: sortedPermissions(s.taggedPermissions),
    folders: s.folders.filter((f) => ctx.visibleFolders.has(f.folderId)).map((f) => ({ _id: f.folder.id, name: f.folder.name })),
    permissions: sortedPermissions(s.permissions),
    seenBy: s.seen.map((x) => x.userId),
    color: s.color,
    isFavorite: ctx.isFavorite,
    canEdit: ctx.canEdit,
    timelineTitle: s.timelineTitle ?? undefined,
    kind: s.kind,
    parentId: s.parentId ?? undefined,
    parent: ctx.parent ? toApiParent(ctx.parent) : undefined,
    link: s.link ?? undefined,
    rangeStart: s.rangeStart ?? undefined,
    rangeEnd: s.rangeEnd ?? undefined,
    sumaroonCount: s.kind === 'running' ? (ctx.sumaroonCount ?? 0) : undefined,
    sumaroonPreview: s.kind === 'running' ? (ctx.sumaroonPreview ?? []).map((x) => ({ _id: x.id, title: x.title })) : undefined,
  };
}

function toApiParent(p: ParentSummary): ApiSummaryParent {
  return {
    _id: p.id,
    title: p.title,
    rangeStart: p.rangeStart!,
    rangeEnd: p.rangeEnd!,
    labels: p.labels.map((l) => ({ name: l.label.name })),
    permissions: sortedPermissions(p.permissions),
  };
}

const sortedPermissions = (ps: { permission: Parameters<typeof toApiPermission>[0] }[]) =>
  ps.map((p) => toApiPermission(p.permission)).sort((a, b) => a.name.localeCompare(b.name, 'he'));
