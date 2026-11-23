// Response shapes of the HTTP API. They mirror summer-client/src/app/shared/models (the client contract),
// which keeps Mongo-era names (`_id`, `creationDate`, `user`…) — the database underneath does not.

import type { Mention } from '../database/schema';
import type { UserPreferences } from './preferences';

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

/** The caller's alert on a query. */
export interface ApiQueryAlert {
  _id: string;
  /** off pauses the alert */
  isActive: boolean;
  isMail: boolean;
  isDigest: boolean;
  creationDate: string;
}

/** A query: a saved search, which may also alert. */
export interface ApiQuery {
  _id: string;
  name: string;
  /** edited with the search box only (simple) or with the condition builder too (advanced) */
  kind: 'simple' | 'advanced';
  search: Record<string, unknown>;
  /** only the owner's own flag; false on others' queries */
  isFavorite: boolean;
  /** others can find, run, copy and alert on it */
  isShared: boolean;
  isMine: boolean;
  owner: UserRef;
  /** how many people other than the owner alert on it */
  followers: number;
  creationDate: string;
  updateDate: string;
  /** the caller's alert on it */
  alert: ApiQueryAlert | null;
}

/** A user group: users and permission groups tagged together. Inactive users are left out. */
export interface ApiUserGroup {
  _id: string;
  name: string;
  users: UserRef[];
  /** permission (group) ids */
  permissions: string[];
  /** only the owner's own flag; false on others' groups */
  isFavorite: boolean;
  /** others can find, use and copy it */
  isShared: boolean;
  isMine: boolean;
  owner: UserRef;
  creationDate: string;
  updateDate: string;
}

/** A personal export format ("pouch"): a Tiptap document with field placeholders that an export fills in. */
export interface ApiPouchFormat {
  _id: string;
  name: string;
  mode: 'perSummary' | 'combined';
  /** Tiptap JSON */
  doc: Record<string, unknown>;
  page: { orientation: 'portrait' | 'landscape'; margins: 'narrow' | 'normal' | 'wide' };
  /** only the owner's own flag; false on others' formats */
  isFavorite: boolean;
  /** others can find, use and copy it */
  isShared: boolean;
  /** the caller owns it */
  isMine: boolean;
  /** the caller's relation: owner, shared with them personally (viewer: use/copy · editor: also change), or only via "everyone" */
  role: 'owner' | 'editor' | 'viewer' | 'public';
  /** owner or editor */
  canEdit: boolean;
  owner: UserRef;
  /** people it's shared with and their roles (active users); others than the owner see only their own entry */
  members: { user: UserRef; role: 'viewer' | 'editor' }[];
  creationDate: string;
  updateDate: string;
}

export interface ApiUser extends UserRef {
  pinnedLabels: string[];
  favoriteLabels: string[];
  pinnedPermissions: string[];
  /** oldest pin first; inactive users are left out */
  pinnedUsers: UserRef[];
  following: string[];
  recentExtraField: string[];
  /** missing keys mean the default */
  preferences: UserPreferences;
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
  /** The query whose alert it came from (opening it highlights by that search). */
  queryId?: string;
}

/** A notifications-page feed entry: the notification, the query whose alert raised it (if any), and its summary. */
export interface ApiNotificationFeedItem extends ApiNotification {
  kind: 'alert' | 'comment' | 'mention' | 'tag' | 'follow';
  /** The alert it came from (also when it rode on a tag or follow notification), and its search in words. */
  query?: { _id: string; name: string; why: string[] };
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
