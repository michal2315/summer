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

Collections and summaries each get an optional `folderId`. An item is in **at most one** folder;
items with no `folderId` are not shown in the hierarchy.

## Rules

- **Visibility:** a user sees a folder if it has no permissions, they are a manager, or they belong to one
  of its permission groups, **and** they can see every ancestor folder.
- **Editing:** only the folder's managers may rename it, change its permissions or managers, delete it,
  add items or remove items.
- **Creating:** anyone may create a root folder; a subfolder requires being a manager of the parent.
  The creator is the default manager when `managers` is empty.
- **Deleting** a folder deletes all its subfolders. Collections/summaries inside are **not** deleted;
  their `folderId` is cleared.
- Draft summaries cannot be placed in folders and are not listed.

## Endpoints

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/folder` | — | `IFolder[]` — every folder visible to the user (flat; the client builds the tree from `parentId`) |
| GET | `/api/folder/:id/items` | — | `IFolderItem[]` — `{ type: 'collection' \| 'summary', _id, name }`; 404 if not visible |
| POST | `/api/folder/create` | `{ name, parentId, permissions, managers }` | `IFolder` |
| POST | `/api/folder/edit/:id` | `{ name, permissions, managers }` | `IFolder` |
| DELETE | `/api/folder/:id` | — | `{}` |
| POST | `/api/folder/:id/items` | `{ items: { type, _id }[] }` | `{}` — moves the items here (out of any previous folder) |
| POST | `/api/folder/:id/items/remove` | `{ items: { type, _id }[] }` | `{}` — takes the items out of this folder |

`IFolder` as returned to the client also has `itemCount` — the number of collections + visible summaries directly
in the folder (used to show an expand arrow before the items are loaded) — and has `permissions` populated (`{ _id, name, groupName, color }[]`) and
`createdBy` populated as a user ref (`{ _id, username, fullName, department }`).

Errors: `400` missing name, `403` not a manager, `404` unknown or invisible folder.
