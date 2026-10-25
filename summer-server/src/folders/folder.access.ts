import { SQL, sql } from 'drizzle-orm';
import { CurrentUser } from '../auth/identity-provider';
import { uuidArray } from '../common/sql';

/**
 * Who may see/edit a folder, as SQL predicates over `folders` (unaliased in the FROM clause): the caller holds
 * every permission of the folder AND of each ancestor (effective requirements are the union up the chain);
 * edit = view AND a manager. Folders do not restrict the items placed in them.
 */
export function folderVisible(me: CurrentUser): SQL {
  return sql`not exists (
    with recursive chain(id, parent_id) as (
      select f.id, f.parent_id from folders f where f.id = "folders"."id"
      union all
      select p.id, p.parent_id from folders p join chain c on p.id = c.parent_id
    )
    select 1 from chain join folder_permissions fp on fp.folder_id = chain.id
    where fp.permission_id <> all(${uuidArray(me.permissionIds)}))`;
}

export function folderEditable(me: CurrentUser): SQL {
  return sql`(${folderVisible(me)} and exists (select 1 from folder_editors fe where fe.folder_id = "folders"."id" and fe.user_id = ${me.id}))`;
}
