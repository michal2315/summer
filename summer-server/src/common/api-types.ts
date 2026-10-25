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

export interface ApiUser extends UserRef {
  pinnedSearches: Record<string, unknown>[];
  pinnedLabels: string[];
  favoriteLabels: string[];
  pinnedPermissions: string[];
  pinnedCollections: string[];
  favoriteCollections: string[];
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

export interface ApiCollectionRef {
  _id: string;
  name: string;
}

export interface ApiCollection extends ApiCollectionRef {
  permissions: ApiPermission[];
  summaries: string[];
  managers: string[];
  createdBy: UserRef;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
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
  collectionIds: ApiCollectionRef[];
  permissions: ApiPermission[];
  seenBy: string[];
  color: string;
  isFavorite: boolean;
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
