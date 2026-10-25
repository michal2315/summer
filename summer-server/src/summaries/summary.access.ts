import { SQL, sql } from 'drizzle-orm';
import { CurrentUser } from '../auth/identity-provider';
import { uuidArray } from '../common/sql';

/**
 * Who may see/edit a summary (handoff §3–4), as SQL predicates over `summaries` (unaliased in the FROM clause).
 * Plain functions rather than a provider so any module can use them without Nest import cycles.
 *
 *  - view: the caller holds EVERY permission the summary requires; drafts only by their creator.
 *    A sumaroon also needs its running summary to be visible (it inherits the parent's permissions).
 *  - with `inheritCollectionPermissions`, a summary also requires the permissions of every collection containing it.
 *  - edit: view AND listed as an editor (creator is added on create). Editing never bypasses viewing.
 *
 * Column references are fully qualified on purpose: drizzle renders `${summaries.id}` as a bare "id" inside select
 * lists, which a subquery would silently bind to its own table's id column.
 */
export interface SummaryAccessPolicy {
  inheritCollectionPermissions: boolean;
}

export function summaryVisible(me: CurrentUser, policy: SummaryAccessPolicy): SQL {
  const parent = sql`("summaries"."parent_id" is null or exists (select 1 from summaries p where p.id = "summaries"."parent_id" and ${ownVisible(me, policy, sql`p`)}))`;
  return sql`(${ownVisible(me, policy, sql`"summaries"`)} and ${parent})`;
}

export function summaryEditable(me: CurrentUser, policy: SummaryAccessPolicy): SQL {
  return sql`(${summaryVisible(me, policy)} and exists (select 1 from summary_editors se where se.summary_id = "summaries"."id" and se.user_id = ${me.id}))`;
}

/** One summary row's own rules (draft owner, own permissions, optionally its collections'), for the row referenced by `s`. */
function ownVisible(me: CurrentUser, policy: SummaryAccessPolicy, s: SQL): SQL {
  const mine = uuidArray(me.permissionIds);
  const own = sql`not exists (select 1 from summary_permissions sp where sp.summary_id = ${s}."id" and sp.permission_id <> all(${mine}))`;
  const inherited = policy.inheritCollectionPermissions
    ? sql` and not exists (select 1 from summary_collections sc join collection_permissions cp on cp.collection_id = sc.collection_id
             where sc.summary_id = ${s}."id" and cp.permission_id <> all(${mine}))`
    : sql``;
  return sql`((${s}."is_draft" = false or ${s}."created_by" = ${me.id}) and ${own}${inherited})`;
}
