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

export interface IUser {
  _id: string;
  username: string;
  fullName: string;
  department?: string;
  isSystem?: boolean;
  pinnedSearches: ISummarySearch[];
  pinnedLabels: string[];
  favoriteLabels: string[];
  pinnedPermissions: string[];
  /** listed first wherever users are tagged or mentioned */
  pinnedUsers: UserRef[];
  following: string[];
  recentExtraField: string[];
}

export type UserRef = Pick<IUser, '_id' | 'username' | 'fullName' | 'department' | 'isSystem'>;

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
  folder: string | null;
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
  /** null when not in a folder, or in one the viewer cannot see */
  folder: IFolderRef | null;
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
 * Home page counter: `total` = published summaries the user can see in the scope (all, a folder with its subfolders, or
 * no folder); `hidden` = ones matching the search that permissions hide, and the missing permissions behind them. A
 * summary missing several counts under each; `only` = hidden by that permission alone.
 */
export interface IAccessStats {
  total: number;
  hidden: number;
  missing: { permission: IPermission; blocking: number; only: number }[];
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
export type QueryField = QueryTextField | 'author' | 'contentType' | 'folder' | 'color' | 'eventDate' | 'createdDate';
export type QueryOp = 'all' | 'any' | 'none' | 'isOneOf' | 'isNot' | 'after' | 'before' | 'between';

/**
 * Capsule (כמוסה): a named word list from the external capsules service, usable in searches and notification rules.
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
  op: QueryOp;
  /** text fields; a capsule is the word `#cap:<id>` */
  words?: string[];
  /** author / folder ids, content type names, color hexes */
  values?: string[];
  /** date fields: ISO instants of local midnight */
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
  /** summaries directly in this folder the user lacks permissions to see */
  hiddenCount: number;
  permissions: IPermission[];
  /** user ids */
  managers: string[];
  createdBy: UserRef;
  createdAt: string;
  updatedAt: string;
}

/** A summary placed in a folder (each sits in at most one; sumaroons never do). */
export interface IFolderItem {
  _id: string;
  name: string;
  kind: SummaryKind;
}

export interface FolderPayload {
  name: string;
  /** create only */
  parentId?: string | null;
  permissions: string[];
  managers: string[];
}

/** Comparison operators for notification-rule conditions, offered per field type (spec §8.1). */
export enum NotificationsFunctionsOptions {
  StringContains = 'stringContains',
  StringNotContains = 'stringNotContains',
  NumberBigger = 'numberBigger',
  NumberSmaller = 'numberSmaller',
  NumberEqual = 'numberEqual',
  NumberBetween = 'numberBetween',
  DateAfter = 'dateAfter',
  DateBefore = 'dateBefore',
  DateBetween = 'dateBetween',
  ArrayContains = 'arrayContains',
  ArrayNotContains = 'arrayNotContains',
  /** content: [capsule id, capsule name] (the name is only for display) */
  CapsuleMatches = 'capsuleMatches',
  CapsuleNotMatches = 'capsuleNotMatches',
}

export interface INotificationSettingsCondition {
  field: IField;
  funcName: NotificationsFunctionsOptions;
  /** operand(s); two entries for *Between. An open-ended bound is the UI's Infinity sentinel, sent as null (JSON has no Infinity). */
  content: (string | number | null)[];
}

export interface INotificationSettings {
  _id?: string;
  name: string;
  /** empty for a search alert */
  conditions: INotificationSettingsCondition[];
  /** any one condition is enough, instead of all of them */
  matchAny?: boolean;
  /** a saved search: notify about published summaries it finds (instead of conditions) */
  search?: ISummarySearch;
  /** also e-mail each match right away */
  isMail: boolean;
  /** also list matches in the daily digest e-mail */
  isDigest: boolean;
  /** the rule is active (matches reach the bell, and the e-mails); off pauses it */
  isNotify: boolean;
  creationDate?: string;
}

/** The user's e-mail switches (GET/PUT /notifications/preferences). */
export interface IMailPreferences {
  /** null when the identity provider has no address: nothing can be mailed */
  email: string | null;
  /** rule matches (each rule also picks immediate and/or digest) */
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
  /** hierarchy folder: omitted = leave as is, null = take out. Not for drafts or sumaroons. */
  folderId?: string | null;
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
