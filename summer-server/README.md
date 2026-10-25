# summer-server

Summer's backend: **NestJS 11 + Drizzle ORM + PostgreSQL 17**. It implements the HTTP contract that
`summer-client` already uses (`/api/...`, Mongo-era field names such as `_id`). Underneath, it uses the
relational model from the server handoff document.

Scope: summaries, collections, the folder hierarchy (`/api/folder`), comments, labels, custom fields, content
types, permissions, favourites/pins/follows, notifications and rules, What's New, attachments and Excel.
Running-summaries and sumeroons are intentionally **not** included yet.

Policy choices and open questions are in [DECISIONS.md](DECISIONS.md).

## Quick start (dev)

Requires Node ≥ 20.12. Nothing else needs installing: PostgreSQL comes from the `embedded-postgres` npm package.

```bash
cp .env.example .env
npm install
npm run db          # terminal 1: embedded PostgreSQL 17 on :5433 (data in .data/pg), Ctrl+C to stop
npm run db:seed     # migrates, then loads deterministic demo data (wipes the dev DB)
npm run start:dev   # terminal 2: API on http://localhost:8080/api (applies migrations on boot)
```

`GET /api/health` → `{ "status": "ok", "db": "up" }`.

### Pointing the client at it

The client runs on its in-browser mock by default. To use this server, change two settings in the client's dev
environment (or set them in `public/env-config.js`):

```ts
mockApi: false,
ssoUrl: '/api/auth/dev-sso',
```

The client's `proxy.conf.json` already forwards `/api` to `:8080`. The dev SSO page signs in as `DEV_LOGIN_USER`
and posts the token back to the opener, exactly like the real SAML popup. To try another user, change
`DEV_LOGIN_USER` and restart the server. To get a token for curl, open `GET /api/auth/dev-token?as=dlevi`.

Dev users and their groups are listed in `src/database/seed/identities.ts`. For example, `mgolan` holds cs, math,
year-1 and staff, and `nmizrahi` holds behavioral and year-1. Logging in as different users is the fastest way
to see the all-of permission rule at work.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run db` | Run the embedded dev PostgreSQL (foreground). |
| `npm run db:migrate` | Apply pending migrations to `DATABASE_URL`. |
| `npm run db:seed` | Migrate, then wipe and load demo data (refused when `NODE_ENV=production`). |
| `npm run db:generate` | Generate a migration from changes in `src/database/schema`. |
| `npm run start:dev` / `build` / `start` | Watch mode, compile to `dist/`, run the build. |
| `npm test` | Unit tests plus e2e tests against a throwaway embedded PostgreSQL on :5434. |
| `npm run typecheck` | `tsc --noEmit`. |

## Structure

```
src/
  database/        DatabaseModule: the ONLY place that talks to PostgreSQL
    client.ts        pool + drizzle instance, migrations runner
    database.service.ts  `db` (current transaction or pool), `transaction()`, `afterCommit()`
    schema/          Drizzle tables + relations
    seed/            dev identities + deterministic seed
  auth/            IdentityProvider adapter (dev now, SSO later), global AuthGuard, dev SSO popup
  summaries/       feed/search, CRUD, attachments, Excel, /field/summaries   ┐
  collections/     collections + membership                                  │ controller → service → repository
  folders/         hierarchy: folder tree + item placement                   │
  content-types/   content types + custom fields (/content-type, /field)
  labels/          label autocomplete + find-or-create
  comments/  users/  permissions/  notifications/  whats-new/
drizzle/           SQL migrations (generated + hand-written invariants)
test/              e2e specs (real PostgreSQL)
```

**Access rules live with their entity** as plain functions that return SQL predicates:
[summary.access.ts](src/summaries/summary.access.ts), [collection.access.ts](src/collections/collection.access.ts)
and [folder.access.ts](src/folders/folder.access.ts). Every query that returns or changes rows applies them
(feed, search, direct links, export, notifications…). They are functions rather than Nest providers, so any
module can import them without creating module cycles. Repositories wrap them for id checks, for example
`SummariesRepository.visibleIds(me, ids, 'edit')`.

**Database access rule:** only repositories touch `DatabaseService.db`. Services compose repositories inside
`database.transaction(async () => …)`. Repositories automatically join the active transaction through
`AsyncLocalStorage`, so a summary, its permissions, labels, fields, collections, files and notifications all
commit or roll back together.

### Migrations

- `0000_extensions`: pg_trgm.
- `0001_init`: generated from the schema.
- `0002_invariants` (hand-written): deferred triggers so that a published summary and a collection each keep
  at least one permission.
- `0003_folders`: the folder tables.
- `0004_folder_invariants` (hand-written): a folder keeps at least one permission, and its parent can't change.

Change the schema, run `npm run db:generate`, review the SQL and commit it. Write custom SQL with
`npx drizzle-kit generate --custom --name=<name>`.

### Search

Search is a substring match (`ILIKE '%term%'`) backed by `pg_trgm` GIN indexes on title, content text, notes,
labels and comments. It matches inside Hebrew and English words. Terms are ANDed, and `"quoted phrases"` match
as a whole. `contentText`/`notesText` are plain-text projections the server keeps for HTML columns. Searches
shorter than 3 characters cannot use the trigram index and fall back to a scan. Elasticsearch can replace this
behind the same endpoints later.

## Configuration

All settings are environment variables, validated at startup. See `.env.example` for the full list.

Production-relevant settings:
- `DATABASE_URL`, `DB_POOL_MAX`
- `AUTH_PROVIDER`: must be `sso` once implemented. `dev` is refused in production.
- `PERMISSION_ADMIN_GROUPS`, `DASHBOARD_GROUPS`
- `UPLOAD_DIR` and file limits
- `APP_TIMEZONE`
- `ACCESS_INHERIT_COLLECTION_PERMISSIONS`

## Not production-ready yet

- **SSO.** `AUTH_PROVIDER=sso` deliberately fails at startup until the university SSO protocol, token
  validation and group API are specified. Implement `IdentityProvider.verify()` in `src/auth`.
- **Open product decisions.** See DECISIONS.md.
