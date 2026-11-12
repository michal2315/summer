// Response shapes of the HTTP API. They mirror summer-client/src/app/shared/models (the client contract),
// which keeps Mongo-era names (`_id`, `creationDate`, `user`…) — the database underneath does not.

import type { Mention } from '../database/schema';

export interface ApiPermission {
  _id: string;
  name: string;
  groupName?: string;
  color: string;
}

export interface UserRef {
  _id: string;
  username: string;
  fullName: string;
  department?: string;
  isSystem?: boolean;
}

/** A personal saved search; without a name the client describes it from its filters. */
export interface ApiSavedSearch {
  _id: string;
  name: string | null;
  search: Record<string, unknown>;
  /** where it was saved from: the search bar (simple) or the advanced panel */
  kind: 'simple' | 'advanced';
  isFavorite: boolean;
}

export interface ApiUser extends UserRef {
  /** favourites first, then newest first */
  pinnedSearches: ApiSavedSearch[];
  pinnedLabels: string[];
  favoriteLabels: string[];
  pinnedPermissions: string[];
  /** oldest pin first; inactive users are left out */
  pinnedUsers: UserRef[];
  following: string[];
  recentExtraField: string[];
}

export interface ApiField {
  _id: string;
  name: string;
  type: string;
}

export interface ApiContentType {
  _id: string;
  name: string;
  displayName: string;
  icon?: string;
  color?: string;
  fields: { field: string; required: boolean }[];
}

export interface ApiComment {
  _id: string;
  content: string;
  mentions: Mention[];
  user: UserRef;
  creationDate: string;
}

export interface ApiFolderRef {
  _id: string;
  name: string;
}

/** A personal template for the summary form's sharing section; references the caller can no longer use are left out. */
export interface ApiSummaryTemplate {
  _id: string;
  name: string;
  permissions: string[];
  taggedUsers: UserRef[];
  taggedPermissions: string[];
  labels: string[];
  folders: string[];
}

/** A sumaroon's running summary: what the sumaroon inherits (labels, permissions) and its date range. */
export interface ApiSummaryParent {
  _id: string;
  title: string;
  rangeStart: string;
  rangeEnd: string;
  labels: { name: string }[];
  permissions: ApiPermission[];
}

export interface ApiSummary {
  _id: string;
  title: string;
  content: string;
  notes: string;
  department: string;
  user: UserRef;
  isDraft: boolean;
  creationDate: string;
  modifyDate: string;
  eventDate?: string;
  eventSecTime?: string;
  contentType: ApiContentType;
  labels: { name: string }[];
  comments: ApiComment[];
  summaryFields: { _id: string; field: ApiField; value: string }[];
  files: string[];
  taggedUsers: UserRef[];
  taggedPermissions: ApiPermission[];
  /** the folders it is in that the caller can see (empty = none) */
  folders: ApiFolderRef[];
  permissions: ApiPermission[];
  seenBy: string[];
  color: string;
  isFavorite: boolean;
  /** The caller is an editor (drives which rows bulk edit actions apply to; the server re-checks on every write). */
  canEdit: boolean;
  timelineTitle?: string;
  kind: 'summary' | 'running' | 'sumaroon';
  /** sumaroon only */
  parentId?: string;
  parent?: ApiSummaryParent;
  link?: string;
  /** running only: yyyy-MM-dd */
  rangeStart?: string;
  rangeEnd?: string;
  /** running only: published sumaroons the viewer can see */
  sumaroonCount?: number;
  /** running only: the first few of those sumaroons by event date (card preview) */
  sumaroonPreview?: { _id: string; title: string }[];
}

/**
 * The home page counter: `total` = all published summaries in the scope (all, a folder with its subfolders, or no
 * folder), including ones the caller can't see; `hidden` = ones in the scope matching the search that permissions hide,
 * and which missing permissions hide them. A summary missing several permissions counts under each.
 */
export interface ApiAccessStats {
  total: number;
  hidden: number;
  missing: { permission: ApiPermission; blocking: number }[];
}

/** Why a bulk action left a summary out. Hidden and nonexistent ids are both `not-found` (A7: non-disclosing). */
export type BulkSkipReason = 'not-found' | 'not-editor' | 'sumaroon' | 'too-many-labels' | 'draft';

/** Bulk actions apply to every eligible summary and report the rest instead of failing the whole batch. */
export interface ApiBulkResult {
  applied: string[];
  skipped: { id: string; reason: BulkSkipReason }[];
}

export interface SummaryLengths {
  summary: number;
  draft: number;
  tagged: number;
  favorite: number;
}

export interface ApiNotification {
  _id: string;
  text: string;
  summaryId?: string;
  creationDate: string;
  isViewed: boolean;
  createdBy?: Pick<UserRef, '_id' | 'username' | 'fullName'>;
}

/** A notifications-page feed entry: the notification, the rule that raised it (if any), and its summary. */
export interface ApiNotificationFeedItem extends ApiNotification {
  kind: 'rule' | 'search' | 'comment' | 'mention' | 'tag' | 'follow';
  rule?: { _id: string; name: string };
  summary: ApiSummary;
}

export const toRef = (u: { id: string; username: string; fullName: string; department: string; isSystem: boolean }): UserRef => ({
  _id: u.id,
  username: u.username,
  fullName: u.fullName,
  department: u.department,
  isSystem: u.isSystem,
});

export const toApiPermission = (p: { id: string; name: string; groupName: string; color: string }): ApiPermission => ({
  _id: p.id,
  name: p.name,
  groupName: p.groupName,
  color: p.color,
});
