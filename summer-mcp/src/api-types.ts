// The parts of summer-server's response shapes (src/common/api-types.ts and friends) that the MCP reads.
// Mongo-era names (`_id`, `creationDate`, `user`) are the API's, not ours.

export type SummaryKind = 'summary' | 'running' | 'sumaroon';

export interface UserRef {
  _id: string;
  username: string;
  fullName: string;
  department?: string;
  isSystem?: boolean;
}

export interface ApiPermission {
  _id: string;
  name: string;
  groupName?: string;
  color: string;
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
  fields: { field: string; required: boolean }[];
}

export interface ApiComment {
  _id: string;
  content: string;
  mentions: { _id: string; type: 'user' | 'label' | 'permission'; value: string }[];
  user: UserRef;
  creationDate: string;
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
  folders: { _id: string; name: string }[];
  permissions: ApiPermission[];
  color: string;
  isFavorite: boolean;
  canEdit: boolean;
  timelineTitle?: string;
  kind: SummaryKind;
  parentId?: string;
  parent?: { _id: string; title: string; rangeStart: string; rangeEnd: string };
  link?: string;
  rangeStart?: string;
  rangeEnd?: string;
  sumaroonCount?: number;
}

export interface SummaryLengths {
  summary: number;
  draft: number;
  tagged: number;
  favorite: number;
}

export interface ApiBulkResult {
  applied: string[];
  skipped: { id: string; reason: string }[];
}

export interface ApiFolder {
  _id: string;
  name: string;
  parentId: string | null;
  itemCount: number;
  subtreeCount: number;
  hiddenCount: number;
  /** user ids of the folder's managers (they place and remove items) */
  managers: string[];
}

export interface ApiFolderItem {
  _id: string;
  name: string;
  kind: SummaryKind;
  mine: boolean;
}

export interface ApiCapsule {
  _id: string;
  name: string;
  description: string;
  words: { word: string; condition: 'must' | 'mustNot' | 'optional' }[];
}

export interface ApiUser extends UserRef {
  pinnedLabels: string[];
  favoriteLabels: string[];
}

export interface ApiQueryAlert {
  _id: string;
  isActive: boolean;
  isMail: boolean;
  isDigest: boolean;
  creationDate: string;
}

export interface ApiQuery {
  _id: string;
  name: string;
  kind: 'simple' | 'advanced';
  search: Record<string, unknown>;
  isFavorite: boolean;
  isShared: boolean;
  isMine: boolean;
  owner: UserRef;
  followers: number;
  creationDate: string;
  updateDate: string;
  alert: ApiQueryAlert | null;
}

export interface ApiNotificationFeedItem {
  _id: string;
  text: string;
  summaryId?: string;
  creationDate: string;
  isViewed: boolean;
  createdBy?: Pick<UserRef, '_id' | 'username' | 'fullName'>;
  kind: 'alert' | 'comment' | 'mention' | 'tag' | 'follow';
  query?: { _id: string; name: string };
  summary: ApiSummary;
}
