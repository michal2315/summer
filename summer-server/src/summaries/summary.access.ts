import { SQL, sql } from 'drizzle-orm';
import { CurrentUser } from '../auth/identity-provider';
import { uuidArray } from '../common/sql';

/**
 * Who may see/edit a summary (handoff §3–4), as SQL predicates over `summaries` (unaliased in the FROM clause).
 * Plain functions rather than a provider so any module can use them without Nest import cycles.
 *
 *  - view: the caller holds EVERY permission the summary requires; drafts only by their creator.
 *    A sumaroon also needs its running summary to be visible (it inherits the parent's permissions).
 *  - edit: view AND listed as an editor (creator is added on create). Editing never bypasses viewing.
 *
 * Column references are fully qualified on purpose: drizzle renders `${summaries.id}` as a bare "id" inside select
 * lists, which a subquery would silently bind to its own table's id column.
 */
export function summaryVisible(me: CurrentUser): SQL {
  const parent = sql`("summaries"."parent_id" is null or exists (select 1 from summaries p where p.id = "summaries"."parent_id" and ${ownVisible(me, sql`p`)}))`;
  return sql`(${ownVisible(me, sql`"summaries"`)} and ${parent})`;
}

export function summaryEditable(me: CurrentUser): SQL {
  return sql`(${summaryVisible(me)} and exists (select 1 from summary_editors se where se.summary_id = "summaries"."id" and se.user_id = ${me.id}))`;
}

/** One summary row's own rules (draft owner, own permissions), for the row referenced by `s`. */
function ownVisible(me: CurrentUser, s: SQL): SQL {
  const mine = uuidArray(me.permissionIds);
  const own = sql`not exists (select 1 from summary_permissions sp where sp.summary_id = ${s}."id" and sp.permission_id <> all(${mine}))`;
  return sql`((${s}."is_draft" = false or ${s}."created_by" = ${me.id}) and ${own})`;
}
