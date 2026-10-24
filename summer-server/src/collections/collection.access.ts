import { SQL, sql } from 'drizzle-orm';
import { CurrentUser } from '../auth/identity-provider';
import { uuidArray } from '../common/sql';

/**
 * Who may see/edit a collection, as SQL predicates over `collections` (unaliased in the FROM clause):
 * view = the caller holds every permission of the collection; edit = view AND a manager.
 */
export function collectionVisible(me: CurrentUser): SQL {
  return sql`not exists (select 1 from collection_permissions cp where cp.collection_id = "collections"."id" and cp.permission_id <> all(${uuidArray(me.permissionIds)}))`;
}

export function collectionEditable(me: CurrentUser): SQL {
  return sql`(${collectionVisible(me)} and exists (select 1 from collection_editors ce where ce.collection_id = "collections"."id" and ce.user_id = ${me.id}))`;
}
