// Data contract — spec §8 / §12. Field names match the existing backend.

export interface IPermission {
  _id: string;
  name: string;
  groupName?: string;
  color: string;
}

export interface INotification {
  _id: string;
  text: string;
  summaryId?: string;
  creationDate: string;
  isViewed: boolean;
  createdBy?: Pick<IUser, '_id' | 'username' | 'fullName'>;
}

/** What raised a notification: a query's alert matched, or another user's activity. */
export type NotificationKind = 'alert' | 'comment' | 'mention' | 'tag' | 'follow';

/** A notifications-page feed entry: the notification, the query whose alert raised it (if any), and its summary. */
export interface INotificationFeedItem extends INotification {
  kind: NotificationKind;
  query?: { _id: string; name: string };
  summary: ISummary;
}

export interface IUser {
  _id: string;
  username: string;
  fullName: string;
  department?: string;
  isSystem?: boolean;
  pinnedLabels: string[];
  favoriteLabels: string[];
  pinnedPermissions: string[];
  /** listed first wherever users are tagged or mentioned */
  pinnedUsers: UserRef[];
  following: string[];
  recentExtraField: string[];
  /** Missing keys mean the default (PreferencesService). */
  preferences?: UserPreferences;
}

/** Personal preferences, set in the preferences dialog. Every key is optional; PreferencesService has the defaults. */
export interface UserPreferences {
  /** Moving to another folder: keep the current search there, or start without one. */
  folderSearch?: 'keep' | 'reset';
  /** Times shown as "3 hours ago", or as the date and hour. */
  dates?: 'relative' | 'exact';
}

/** How a query is edited: the search box text only (simple), or with the condition builder too (advanced). */
export type QueryKind = 'simple' | 'advanced';

/** The caller's alert on a query: notifications (and e-mails) about summaries it finds later. */
export interface IQueryAlert {
  _id: string;
  /** off pauses the alert */
  isActive: boolean;
  /** also e-mail each match right away */
  isMail: boolean;
  /** also list matches in the daily digest e-mail */
  isDigest: boolean;
  creationDate: string;
}

/** A query: a named search. Every query is one of the user's saved searches, and may alert. */
export interface IQuery {
  _id: string;
  name: string;
  kind: QueryKind;
  search: ISummarySearch;
  /** The owner's own flag (false on others' queries). */
  isFavorite: boolean;
  /** Others can find, run, copy and alert on it. */
  isShared: boolean;
  isMine: boolean;
  owner: UserRef;
  /** How many people other than the owner alert on it. */
  followers: number;
  creationDate: string;
  updateDate: string;
  /** The current user's alert on it. */
  alert: IQueryAlert | null;
}

/** Alert settings as they are sent. */
export type QueryAlertSettings = Pick<IQueryAlert, 'isActive' | 'isMail' | 'isDigest'>;

export type UserRef = Pick<IUser, '_id' | 'username' | 'fullName' | 'department' | 'isSystem'>;

/** A user group: users and permission groups tagged together. Picking it in a tag field tags all of them. */
export interface IUserGroup {
  _id: string;
  name: string;
  /** Active users only, in the order they were added. */
  users: UserRef[];
  /** Permission (group) ids. */
  permissions: string[];
  /** The owner's own flag (false on others' groups). */
  isFavorite: boolean;
  /** Others can find, use and copy it. */
  isShared: boolean;
  isMine: boolean;
  owner: UserRef;
  creationDate: string;
  updateDate: string;
}

export type UserGroupPayload = Pick<IUserGroup, 'name' | 'isFavorite' | 'isShared'> & { users: string[]; permissions: string[] };

export enum FieldsType {
  String = 'string',
  Number = 'number',
  Date = 'date',
  Hour = 'hour',
  Array = 'array',
}

export interface IField {
  _id: string;
  name: string;
  type: FieldsType;
}

export interface IContentTypeField {
  field: string; // IField._id
  required: boolean;
}

export interface IContentType {
  _id: string;
  name: string; // lecture | video | textbook | article | generic
  displayName: string;
  icon?: string;
  color?: string;
  fields?: IContentTypeField[];
}

export interface ILabel {
  name: string;
}

export interface IMention {
  _id: string;
  type: 'user' | 'label' | 'permission';
  value: string;
  icon?: string;
}

export interface IComment {
  _id: string;
  content: string;
  mentions: IMention[];
  user: UserRef;
  creationDate: string;
}

export interface ISummaryField {
  _id?: string;
  field: IField;
  value: string | undefined;
}

export interface IFolderRef {
  _id: string;
  name: string;
}

/** A personal preset for the summary form's sharing section. The server leaves out users who no longer exist. */
export interface ISummaryTemplate {
  _id: string;
  name: string;
  permissions: string[];
  taggedUsers: UserRef[];
  taggedPermissions: string[];
  labels: string[];
  folders: string[];
}

export type SummaryTemplatePayload = Omit<ISummaryTemplate, '_id' | 'taggedUsers'> & { taggedUsers: string[] };

/** summary = regular; running = תמצית רצף (a focused series with a date range); sumaroon = תמציתונית (one entry of a series). */
export enum SummaryKind {
  Summary = 'summary',
  Running = 'running',
  Sumaroon = 'sumaroon',
}

export const SUMMARY_KIND_LABEL: Record<SummaryKind, string> = {
  [SummaryKind.Summary]: 'תמצית',
  [SummaryKind.Running]: 'תמצית רצף',
  [SummaryKind.Sumaroon]: 'תמציתונית',
};

/** A sumaroon's running summary: what it inherits (labels, permissions) and the range its date must fall in. */
export interface ISummaryParent {
  _id: string;
  title: string;
  /** yyyy-MM-dd */
  rangeStart: string;
  rangeEnd: string;
  labels: ILabel[];
  permissions: IPermission[];
}

export interface ISummary {
  _id: string;
  title: string;
  content: string; // Quill HTML
  notes: string; // Quill HTML
  department: string;
  user: UserRef;
  isDraft: boolean;
  creationDate: string;
  modifyDate: string;
  eventDate?: string;
  eventSecTime?: string;
  contentType: IContentType;
  labels: ILabel[];
  comments: IComment[];
  summaryFields?: ISummaryField[];
  files: string[];
  taggedUsers: UserRef[];
  /** permission groups whose members count as tagged */
  taggedPermissions: IPermission[];
  /** the folders it is in that the viewer can see (empty = none); the same summary in each, not copies */
  folders: IFolderRef[];
  permissions: IPermission[];
  seenBy: string[];
  color: string;
  isFavorite: boolean;
  /** The viewer is an editor (bulk edit actions apply only to these; the server re-checks). */
  canEdit: boolean;
  timelineTitle?: string;
  kind: SummaryKind;
  /** sumaroon only */
  parentId?: string;
  parent?: ISummaryParent;
  link?: string;
  /** running only: yyyy-MM-dd */
  rangeStart?: string;
  rangeEnd?: string;
  /** running only: published sumaroons the viewer can see */
  sumaroonCount?: number;
  /** running only: the first few of those sumaroons by event date (card preview) */
  sumaroonPreview?: { _id: string; title: string }[];
}

/** Why a bulk action left a summary out (hidden and deleted summaries are both 'not-found'). */
export type BulkSkipReason = 'not-found' | 'not-editor' | 'sumaroon' | 'too-many-labels' | 'draft';

/**
 * Home page counter: `total` = all published summaries in the scope (all, a folder with its subfolders, or no folder),
 * including ones the user can't see; `hidden` = ones matching the search that permissions hide, and the missing
 * permissions behind them. A summary missing several counts under each.
 */
export interface IAccessStats {
  total: number;
  hidden: number;
  missing: { permission: IPermission; blocking: number }[];
}

export interface IBulkResult {
  applied: string[];
  skipped: { id: string; reason: BulkSkipReason }[];
}

export interface ISummariesLength {
  summary: number;
  draft: number;
  tagged: number;
  favorite: number;
}

export interface ISummariesResponse {
  summaries: ISummary[];
  lengths: ISummariesLength;
}

export enum SearchType {
  Title = 'TITLE',
  Label = 'LABEL',
  Content = 'CONTENT',
  Notes = 'NOTES',
  Comments = 'COMMENTS',
  Color = 'COLOR',
}

/** Which bucket of summaries to list. Drives the profile tabs. */
export enum SummarySearch {
  Summary = 'SUMMARY',
  Draft = 'DRAFT',
  Tagged = 'TAGGED',
  Favorite = 'FAVORITE',
}

export type SortKey = 'eventDate' | '-eventDate' | 'creationDate' | '-creationDate' | 'modifyDate' | '-modifyDate' | 'title' | '-title';

export interface ISummarySearch {
  text?: string;
  searchTypes?: SearchType[];
  /** [from, to] event-date range, ISO strings */
  dates?: string[];
  /** [from, to] creation-date range, ISO strings */
  createdDates?: string[];
  sort?: SortKey;
  skip?: number;
  limit?: number;
  /** user ids */
  users?: string[];
  department?: string;
  summarySearch?: SummarySearch;
  isProfile?: boolean;
  isPin?: boolean;
  isTagged?: boolean;
  /** content type names */
  contentTypes?: string[];
  colors?: string[];
  labels?: string[];
  /** placed in one of these folders or their subfolders */
  folders?: string[];
  /** only summaries that are in no folder */
  noFolder?: boolean;
  /** only these kinds; empty = all */
  kinds?: SummaryKind[];
  /** the sumaroons of this running summary */
  parentId?: string;
  /** advanced search tree (query builder), ANDed with everything else */
  query?: IQueryGroup;
}

export type QueryTextField = 'text' | 'title' | 'content' | 'notes' | 'comments' | 'labels';
/** `field`: a content-type catalog field, named by the condition's `fieldId`. */
export type QueryField = QueryTextField | 'author' | 'contentType' | 'folder' | 'color' | 'eventDate' | 'createdDate' | 'field';
/** eq / gt / lt / range compare a number catalog field (eq and gt read `from`, lt reads `to`). */
export type QueryOp = 'all' | 'any' | 'none' | 'isOneOf' | 'isNot' | 'after' | 'before' | 'between' | 'eq' | 'gt' | 'lt' | 'range';

/**
 * Capsule (כמוסה): a named word list from the external capsules service, usable in searches and alerts.
 * must: every one has to appear · mustNot: none may appear ·
 * optional: with no must words, at least one has to appear; otherwise they only add highlights.
 */
export type CapsuleCondition = 'must' | 'mustNot' | 'optional';

export interface ICapsuleWord {
  word: string;
  condition: CapsuleCondition;
}

export interface ICapsule {
  _id: string;
  name: string;
  description: string;
  words: ICapsuleWord[];
}

export interface IQueryCondition {
  type: 'cond';
  field: QueryField;
  /** the catalog field, for `field: 'field'` */
  fieldId?: string;
  op: QueryOp;
  /** text fields; a capsule is the word `#cap:<id>` */
  words?: string[];
  /** author / folder ids, content type names, color hexes; list catalog fields: the items */
  values?: string[];
  /** date fields: ISO instants of local midnight; number catalog fields: the bounds, as numbers in text */
  from?: string;
  to?: string;
}

export interface IQueryGroup {
  type: 'group';
  op: 'AND' | 'OR';
  children: (IQueryGroup | IQueryCondition)[];
}

/** A node in the folder tree (home page). Folders nest via parentId; root folders have parentId null. */
export interface IFolder {
  _id: string;
  name: string;
  parentId: string | null;
  /** summaries directly in this folder (not counting subfolders) */
  itemCount: number;
  /** distinct summaries the user can see in this folder and all its subfolders (one in several of them counts once) */
  subtreeCount: number;
  /** summaries directly in this folder the user lacks permissions to see */
  hiddenCount: number;
  permissions: IPermission[];
  /** user ids */
  managers: string[];
  /** The legacy root (collections from the old Summer), a collection in it, or neither. Nothing can be added to either. */
  legacy: 'root' | 'collection' | null;
  createdBy: UserRef;
  createdAt: string;
  updatedAt: string;
}

/** A collection from the old Summer, waiting in the legacy root (GET /legacy). */
export interface ILegacyCollection {
  folder: IFolder;
  /** placements when it was imported */
  total: number;
  /** placements still in it, including folder.hiddenCount the user cannot see */
  left: number;
}

export interface ILegacyOverview {
  /** null: nothing was imported */
  rootId: string | null;
  /** dev only: the staging page may offer "reset the demo" */
  demo?: boolean;
  /** collections still waiting that the user manages */
  collections: ILegacyCollection[];
  /** over every collection the user manages or managed, including ones already moved out or deleted */
  progress: { total: number; left: number; collections: number; done: number };
}

export interface ILegacyItem extends IFolderItem {
  /** folders outside the legacy root it is already in */
  alsoIn: { _id: string; name: string }[];
  /** other legacy collections it also waits in */
  alsoLegacy: { _id: string; name: string }[];
}

export interface ILegacyResult {
  applied: string[];
  /** placements left in the collection */
  left: number;
}

export interface ILegacyMoveResult extends IBulkResult {
  /** of applied, the ones that were not in the target before */
  added: string[];
  left: number;
}

/** A summary placed in a folder (each sits in at most one; sumaroons never do). */
export interface IFolderItem {
  _id: string;
  name: string;
  kind: SummaryKind;
  /** The current user wrote it (only those can be dragged to another folder in the tree). */
  mine: boolean;
}

export interface FolderPayload {
  name: string;
  /** create only */
  parentId?: string | null;
  permissions: string[];
  managers: string[];
}

/** The user's e-mail switches (GET/PUT /notifications/preferences). */
export interface IMailPreferences {
  /** null when the identity provider has no address: nothing can be mailed */
  email: string | null;
  /** alert matches (each alert also picks immediate and/or digest) */
  mailAlerts: boolean;
  /** tags, comments, mentions, followed users publishing */
  mailActivity: boolean;
}

export interface IWhatsNew {
  version: string;
  date: string;
  isAcknowledged: boolean;
}

export interface SummaryPayload {
  id?: string;
  title: string;
  contentHtml: string;
  notesHtml: string;
  contentType: string;
  eventDate?: string;
  eventSecTime?: string;
  department: string;
  labels: string[];
  /** hierarchy folders: omitted = leave as is, [] = take out of every one. Not for drafts or sumaroons. */
  folderIds?: string[];
  permissions: string[];
  taggedUsers: string[];
  taggedPermissions: string[];
  summaryFields: { field: string; value: string }[];
  /** existing attachment names to keep (edit) */
  files: string[];
  isDraft: boolean;
  /** fixed at creation */
  kind: SummaryKind;
  /** sumaroon: its running summary (fixed at creation) */
  parentId?: string;
  /** running: yyyy-MM-dd */
  rangeStart?: string;
  rangeEnd?: string;
  /** sumaroon */
  link?: string;
}
