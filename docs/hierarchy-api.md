# Hierarchy (folders) API

Backs the `/hierarchy` page in summer-client. The client-side mock lives in
`summer-client/src/app/mock/mock-backend.ts` (section "hierarchy") and is the reference implementation.

## Data

```ts
Folder {
  _id: string
  name: string
  parentId: string | null        // null = root folder
  permissions: string[]          // permission-group ids; empty = open
  managers: string[]             // user ids
  createdBy: string              // user id
  createdAt, updatedAt: ISO date
}
```

Summaries are organized only by folders (there are no collections). A summary is in **at most one** folder, or in
none; summaries with no folder are not shown in the hierarchy. Regular and running summaries can be placed;
sumaroons live inside their running summary, and drafts are never placed.

A summary's folder is also set from the summary form: `SummaryPayload.folderId` (omitted = leave as is, `null` =
take out). `ISummary.folder` is `{ _id, name }`, or `null` when the summary is in no folder or in one the viewer
cannot see.

## Rules

- **Visibility:** a user sees a folder if it has no permissions, they are a manager, or they belong to one
  of its permission groups, **and** they can see every ancestor folder.
- **Editing:** only the folder's managers may rename it, change its permissions or managers, delete it,
  add summaries or remove summaries. Moving a summary also needs edit rights on it.
- **Creating:** anyone may create a root folder; a subfolder requires being a manager of the parent.
  The creator is the default manager when `managers` is empty.
- **Deleting** a folder deletes all its subfolders. Summaries inside are **not** deleted, only taken out of
  the hierarchy.
- Draft summaries cannot be placed in folders and are not listed.

## Endpoints

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/folder` | — | `IFolder[]` — every folder visible to the user (flat; the client builds the tree from `parentId`) |
| GET | `/api/folder/:id/items` | — | `IFolderItem[]` — `{ _id, name, kind }` (summaries the caller may see); 404 if not visible |
| POST | `/api/folder/create` | `{ name, parentId, permissions, managers }` | `IFolder` |
| POST | `/api/folder/edit/:id` | `{ name, permissions, managers }` | `IFolder` |
| DELETE | `/api/folder/:id` | — | `{}` |
| POST | `/api/folder/:id/items` | `{ summaryIds: string[], partial?: boolean }` | `{ applied, skipped }` — moves the summaries here (out of any previous folder) |
| POST | `/api/folder/:id/items/remove` | `{ summaryIds: string[] }` | `{}` — takes the summaries out of this folder |

`IFolder` as returned to the client also has `itemCount` — the number of visible summaries directly
in the folder (used to show an expand arrow before the items are loaded) — and has `permissions` populated (`{ _id, name, groupName, color }[]`) and
`createdBy` populated as a user ref (`{ _id, username, fullName, department }`).

Errors: `400` missing name, `403` not a manager, `404` unknown or invisible folder.
