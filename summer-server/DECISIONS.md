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
| L4 | Notifications are written in the same transaction as the change that caused them. Triggers: tagged, comment on your summary, mention, a followed user publishes, a rule matches on publish or edit. Each notification row is also the e-mail outbox (see Mail). |

## Mail

| # | Rule | Status |
| --- | --- | --- |
| M1 | Two switches per user, both on by default: `mailActivity` (tags, comments, mentions, followed users publishing) and `mailAlerts` (rule matches). Each rule picks **immediate** (`isMail`) and/or **daily digest** (`isDigest`). `isNotify` means the rule is active; a paused rule raises nothing. | Chosen default |
| M2 | Whether to mail is decided when the notification is created, from the switches at that moment. The `mail`/`digest` flags on `notifications` are the outbox. `MailWorker` sends them every `MAIL_POLL_SECONDS`, after the transaction commits. A rolled-back change never mails. | Chosen default |
| M3 | Before sending, the worker re-checks the address and access to the summary (by last-known groups, as for creating notifications). Digest items are also dropped if their rule was deleted, paused or taken off the digest, or alert mails were turned off. | Chosen default |
| M4 | Delivery is at most once: rows are claimed with `FOR UPDATE SKIP LOCKED` (safe with several instances) and cleared before sending. A failed send is re-queued, up to 5 attempts. A crash between claiming and sending loses those mails. | Chosen default |
| M5 | The digest goes out once a day after `DIGEST_HOUR` (`APP_TIMEZONE`). It covers matches created before that hour, one mail per user, grouped by rule. Restart-safe: no "last run" state, the flags are the state. | Chosen default |
| M6 | One notification per person per event still holds. When a followed author's summary also matches your rule, the rule's mail choices are added to the follow notification. | Chosen default |
| M7 | `MAIL_TRANSPORT=log` (default) only writes mails to the server log. Real mail goes through **Microsoft Graph** (`graph`): an Entra app with the `Mail.Send` application permission sends as the `MAIL_FROM` mailbox, so it works from any network and passes SPF/DKIM. Direct SMTP to Microsoft 365 is refused from residential IPs (Spamhaus). `smtp` + `SMTP_URL` remains for other providers. `APP_URL` sets links. `npm run mail:test` sends one sample. | Ops |
| M8 | Every mail uses one layout, `mail/layout.html` (`{{x}}` escaped, `{{{x}}}` HTML), with `mail/summer-logo.png` attached inline as `cid:summer-logo`. The `mail/` folder must ship next to `dist/`, like `drizzle/`. `MAIL_REDIRECT_TO` sends every mail to one address (subject keeps the intended recipient). `MAIL_PREVIEW_DIR` (log transport) writes each mail as an .html file. | Ops |

## Bulk actions

| # | Rule | Status |
| --- | --- | --- |
| B1 | Bulk actions apply to every eligible summary and return `{ applied, skipped: [{ id, reason }] }` instead of failing the whole batch. Rights are re-checked under row locks, taken in id order. Hidden and nonexistent ids are both reported as `not-found` (A7). | Chosen default |
| B2 | Bulk labels (`POST /summary/bulk/labels`) require edit rights. Added labels go after the existing ones, and a summary that would exceed 100 labels is skipped. | Chosen default |
| B3 | Bulk add to a collection (`POST /collection/add` with `partial: true`) keeps A10: you need edit rights on each summary. Without `partial`, the endpoint stays all-or-nothing. | Confirmed + chosen default |
| B4 | Like Excel import (L3), bulk edits send no follower or rule notifications. | Chosen default |
| B5 | Every summary response carries `canEdit` for the caller. The client uses it only to decide what to show. | Chosen default |

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
