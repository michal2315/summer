# Decision record

Each entry lists what the server does today. Rules **confirmed** in the handoff are implemented as stated.
**Chosen default** entries are policies I picked where the handoff left a question open. Each can be changed,
and the code location is noted.

## Access

| # | Rule | Status |
| --- | --- | --- |
| A1 | To view a summary or collection, the user must hold **every** permission assigned to it (`required ⊆ userGroups`). The rule applies the same way in feed, search, direct links, collection pages, export, dashboard and notifications. | Confirmed. `summary.access.ts`, `collection.access.ts`, `folder.access.ts` |
| A2 | Published summaries and every collection need at least one permission. This is enforced by validation and by deferred DB triggers. | Confirmed |
| A3 | **Drafts** may have no permissions, and only their creator can see them. | Chosen default (the client lets you save a draft before choosing permissions) |
| A4 | A summary does **not** inherit the permissions of the collections it is in. Inheritance is implemented behind `ACCESS_INHERIT_COLLECTION_PERMISSIONS=true` and tested, but stays off until product confirms the global hiding effect (handoff §4). | Your choice |
| A5 | Editing requires view access **and** being an editor. The creator is added as an editor on create. Nothing exposes editor management yet, so in practice the creator is the only editor. | Confirmed + chosen default |
| A6 | You can only assign permission groups **you belong to**. Assigning any other group returns 400, because under A1 you would create content you cannot see yourself. | Chosen default (open question in the handoff) |
| A7 | A hidden or nonexistent id returns **404**. A visible row you may not change returns **403**. | Proposed in the handoff |
| A8 | Comments inherit the summary's access. Any viewer may comment, and only the comment's author may delete it. | Chosen default |
| A9 | Card **colour** is shared, and any viewer may set it, matching the client, which shows the picker on every card. **Timeline title** and **to-draft** require editor rights. | Matches the client |
| A10 | Adding a summary to a collection requires view access to the collection **and** edit rights on the summary. Removing a member requires collection-manager rights. | Handoff §3 + client |
| A11 | Saving a summary only changes its memberships in collections the editor can see. Memberships in hidden collections are preserved. | Chosen default (prevents silent removal) |
| A12 | A permission group cannot be deleted while any summary or collection still uses it (409). Removing a requirement would silently widen access. | Chosen default |
| A13 | Permission admins and dashboard users are configured by external group (`PERMISSION_ADMIN_GROUPS`, `DASHBOARD_GROUPS`). | Chosen default (the mock hard-coded one group) |

## Hierarchy (folders)

| # | Rule | Status |
| --- | --- | --- |
| F1 | Folders are viewed like collections: at least one permission, **all** of them required (validation plus a DB trigger). A folder is visible only if every **ancestor** is visible too, so the effective requirements are the union of the whole chain. | Your choice (stricter than the client mock, which allowed open, any-of folders) |
| F2 | Folders are **navigation only**. They do not restrict the summaries and collections inside them, which stay reachable under their own permissions. Folder item lists and `itemCount` still filter each item by its own visibility. | Your choice |
| F3 | An item lives in at most one folder. Placing it somewhere else moves it. Placing needs management of the destination folder **and** edit rights on the item (summary editor or collection manager). Drafts cannot be placed. | Your choice + handoff §3 |
| F4 | Any user may create a root folder. A subfolder needs a manager of the parent. The creator is always a manager. | Matches the client |
| F5 | A folder's parent is fixed at creation (a DB trigger rejects changes), so cycles cannot form. A future "move folder" feature needs a locked cycle check. | Chosen default |
| F6 | Deleting a folder deletes its whole subtree, including subfolders managed by others. The items inside are only taken out of the hierarchy. | Matches the client ("Deletes the folder and its subfolders") |

**Client follow-up:** the folder editor doesn't require permission groups yet. Saving a folder with none gets a 400 from the server.

## Identity and freshness

| # | Rule |
| --- | --- |
| I1 | Identity comes only from the verified bearer token. The client's `_id` header is ignored. |
| I2 | Users are keyed by (issuer, subject) and created or refreshed on sign-in. Groups come from the identity provider on every token resolution. |
| I3 | A verified identity is cached for `AUTH_CACHE_TTL_SECONDS` (default 60s). That is the maximum delay before a group revocation applies. The permission catalog mapping is cached for 30s. |
| I4 | `users.last_group_keys` is a snapshot used **only** to decide whether to create a notification for someone else. Reading notifications always re-checks access with fresh groups, so a stale snapshot never exposes content. |
| I5 | Dev auth (HMAC-signed `dev.<user>.<sig>` tokens plus a fixture directory) is refused when `NODE_ENV=production`. |

## Lifecycle

| # | Rule |
| --- | --- |
| L1 | Deletion is **hard**: deleting a summary cascades its comments, fields, labels links, favourites, notifications, memberships and attachments. Soft delete and restore are not implemented. |
| L2 | Deleting a collection removes the collection and its memberships. The summaries stay. |
| L3 | Excel import is all-or-nothing in one transaction and does not send follower or rule notifications. |
| L4 | Notifications are written in the same transaction as the change that caused them (no outbox yet). Triggers: tagged, comment on your summary, mention, a followed user publishes, a rule matches on publish. `isMail` is stored but no e-mail is sent. |

## Concurrency

- Edits lock the summary row (`FOR UPDATE`) and re-check rights under the lock.
- `version` increments on every change. If a client sends `version`, a stale edit returns 409. The client
  doesn't send it yet, because `ISummary` doesn't expose it.

## Open, for product

- Collection inheritance (A4) and assigning groups you don't hold (A6).
- Editor management UI and API, and who may change editors and permissions.
- Soft deletion and restore.
- SSO protocol and group API.
- Search semantics beyond AND and phrases (Hebrew niqqud normalization, relevance ordering).
- Notification e-mail.
- Running-summaries and sumeroons (deferred by request).
- Folder depth limit (six levels was discussed, not confirmed) and moving folders.

## Known dependency constraint

`sanitize-html` is pinned to 2.17.5. Newer versions depend on ESM-only `htmlparser2`, which Node 20.12 cannot
`require()`. npm audit lists moderate advisories for ≤2.17.7. Our allow-list excludes the tags those advisories
rely on (`svg`, `textarea`, `noscript`, `meta`), and the client also renders through DOMPurify. **Upgrade
Node to ≥ 20.19 (or 22 LTS) and move to sanitize-html ≥ 2.18.1.**
