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
  pinnedCollections: string[];
  favoriteCollections: string[];
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
  type: 'user' | 'label';
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

export interface ICollectionRef {
  _id: string;
  name: string;
}

export interface ICollection extends ICollectionRef {
  permissions: IPermission[];
  summaries: string[];
  /** user ids */
  managers: string[];
  createdBy: UserRef;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
}

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
  collectionIds: ICollectionRef[];
  permissions: IPermission[];
  seenBy: string[];
  color: string;
  isFavorite: boolean;
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
  collections?: string[];
  /** only these kinds; empty = all */
  kinds?: SummaryKind[];
  /** the sumaroons of this running summary */
  parentId?: string;
}

export interface CollectionPayload {
  name: string;
  permissions: string[];
  managers: string[];
  /** edit only: summary ids to remove from the collection */
  summaries?: string[];
}

/** A node in the hierarchy (/hierarchy). Folders nest via parentId; root folders have parentId null. */
export interface IFolder {
  _id: string;
  name: string;
  parentId: string | null;
  /** collections + summaries directly in this folder (not counting subfolders) */
  itemCount: number;
  permissions: IPermission[];
  /** user ids */
  managers: string[];
  createdBy: UserRef;
  createdAt: string;
  updatedAt: string;
}

export type FolderItemType = 'collection' | 'summary';

/** A collection or summary placed in a folder. Each item lives in at most one folder. */
export interface IFolderItem {
  type: FolderItemType;
  _id: string;
  name: string;
  /** summaries only (sumaroons never sit in folders) */
  kind?: SummaryKind;
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
  conditions: INotificationSettingsCondition[];
  /** also send e-mail */
  isMail: boolean;
  /** show in-app bell notification */
  isNotify: boolean;
  creationDate?: string;
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
  collectionIds: string[];
  permissions: string[];
  taggedUsers: string[];
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
