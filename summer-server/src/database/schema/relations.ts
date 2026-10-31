import { relations } from 'drizzle-orm';
import { contentTypeFields, contentTypes, fields, labels, permissions } from './catalog';
import { collectionEditors, collectionPermissions, collections, summaryCollections } from './collections';
import {
  comments,
  summaries,
  summaryEditors,
  summaryFields,
  summaryFiles,
  summaryLabels,
  summaryPermissions,
  summarySeen,
  summaryTaggedPermissions,
  summaryTaggedUsers,
} from './summaries';
import { folderEditors, folderPermissions, folders } from './folders';
import { users } from './users';

// Relations drive `db.query.*.findMany({ with })`, which loads nested lists as JSON sub-selects (no row multiplication).

export const summariesRelations = relations(summaries, ({ one, many }) => ({
  author: one(users, { fields: [summaries.createdBy], references: [users.id] }),
  contentType: one(contentTypes, { fields: [summaries.contentTypeId], references: [contentTypes.id] }),
  permissions: many(summaryPermissions),
  editors: many(summaryEditors),
  labels: many(summaryLabels),
  fields: many(summaryFields),
  taggedUsers: many(summaryTaggedUsers),
  taggedPermissions: many(summaryTaggedPermissions),
  seen: many(summarySeen),
  files: many(summaryFiles),
  comments: many(comments),
  collections: many(summaryCollections),
}));

export const summaryPermissionsRelations = relations(summaryPermissions, ({ one }) => ({
  summary: one(summaries, { fields: [summaryPermissions.summaryId], references: [summaries.id] }),
  permission: one(permissions, { fields: [summaryPermissions.permissionId], references: [permissions.id] }),
}));
export const summaryEditorsRelations = relations(summaryEditors, ({ one }) => ({
  summary: one(summaries, { fields: [summaryEditors.summaryId], references: [summaries.id] }),
}));
export const summaryLabelsRelations = relations(summaryLabels, ({ one }) => ({
  summary: one(summaries, { fields: [summaryLabels.summaryId], references: [summaries.id] }),
  label: one(labels, { fields: [summaryLabels.labelId], references: [labels.id] }),
}));
export const summaryFieldsRelations = relations(summaryFields, ({ one }) => ({
  summary: one(summaries, { fields: [summaryFields.summaryId], references: [summaries.id] }),
  field: one(fields, { fields: [summaryFields.fieldId], references: [fields.id] }),
}));
export const summaryTaggedUsersRelations = relations(summaryTaggedUsers, ({ one }) => ({
  summary: one(summaries, { fields: [summaryTaggedUsers.summaryId], references: [summaries.id] }),
  user: one(users, { fields: [summaryTaggedUsers.userId], references: [users.id] }),
}));
export const summaryTaggedPermissionsRelations = relations(summaryTaggedPermissions, ({ one }) => ({
  summary: one(summaries, { fields: [summaryTaggedPermissions.summaryId], references: [summaries.id] }),
  permission: one(permissions, { fields: [summaryTaggedPermissions.permissionId], references: [permissions.id] }),
}));
export const summarySeenRelations = relations(summarySeen, ({ one }) => ({
  summary: one(summaries, { fields: [summarySeen.summaryId], references: [summaries.id] }),
}));
export const summaryFilesRelations = relations(summaryFiles, ({ one }) => ({
  summary: one(summaries, { fields: [summaryFiles.summaryId], references: [summaries.id] }),
}));
export const commentsRelations = relations(comments, ({ one }) => ({
  summary: one(summaries, { fields: [comments.summaryId], references: [summaries.id] }),
  author: one(users, { fields: [comments.createdBy], references: [users.id] }),
}));
export const summaryCollectionsRelations = relations(summaryCollections, ({ one }) => ({
  summary: one(summaries, { fields: [summaryCollections.summaryId], references: [summaries.id] }),
  collection: one(collections, { fields: [summaryCollections.collectionId], references: [collections.id] }),
}));

export const contentTypesRelations = relations(contentTypes, ({ many }) => ({
  fields: many(contentTypeFields),
}));
export const contentTypeFieldsRelations = relations(contentTypeFields, ({ one }) => ({
  contentType: one(contentTypes, { fields: [contentTypeFields.contentTypeId], references: [contentTypes.id] }),
  field: one(fields, { fields: [contentTypeFields.fieldId], references: [fields.id] }),
}));

export const collectionsRelations = relations(collections, ({ one, many }) => ({
  author: one(users, { fields: [collections.createdBy], references: [users.id] }),
  permissions: many(collectionPermissions),
  editors: many(collectionEditors),
  summaries: many(summaryCollections),
}));
export const collectionPermissionsRelations = relations(collectionPermissions, ({ one }) => ({
  collection: one(collections, { fields: [collectionPermissions.collectionId], references: [collections.id] }),
  permission: one(permissions, { fields: [collectionPermissions.permissionId], references: [permissions.id] }),
}));
export const collectionEditorsRelations = relations(collectionEditors, ({ one }) => ({
  collection: one(collections, { fields: [collectionEditors.collectionId], references: [collections.id] }),
}));

export const foldersRelations = relations(folders, ({ one, many }) => ({
  author: one(users, { fields: [folders.createdBy], references: [users.id] }),
  permissions: many(folderPermissions),
  editors: many(folderEditors),
}));
export const folderPermissionsRelations = relations(folderPermissions, ({ one }) => ({
  folder: one(folders, { fields: [folderPermissions.folderId], references: [folders.id] }),
  permission: one(permissions, { fields: [folderPermissions.permissionId], references: [permissions.id] }),
}));
export const folderEditorsRelations = relations(folderEditors, ({ one }) => ({
  folder: one(folders, { fields: [folderEditors.folderId], references: [folders.id] }),
}));
