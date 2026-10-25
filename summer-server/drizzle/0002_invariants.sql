-- Cross-row invariants that plain FKs/CHECKs cannot express (handoff §8).
-- Constraint triggers are DEFERRABLE INITIALLY DEFERRED so a transaction may replace a permission set
-- (delete all, insert new) and is only checked at COMMIT.

-- A published summary must keep at least one viewing permission (drafts may have none: only their creator sees them).
CREATE FUNCTION summer_check_summary_permissions() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  sid uuid;
BEGIN
  -- IF, not CASE: PL/pgSQL only resolves NEW/OLD fields in the branch that runs.
  IF TG_TABLE_NAME = 'summaries' THEN sid := NEW.id; ELSE sid := OLD.summary_id; END IF;
  IF EXISTS (SELECT 1 FROM summaries s WHERE s.id = sid AND NOT s.is_draft)
     AND NOT EXISTS (SELECT 1 FROM summary_permissions sp WHERE sp.summary_id = sid) THEN
    RAISE EXCEPTION 'published summary % must have at least one permission', sid USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER summaries_require_permission
  AFTER INSERT OR UPDATE OF is_draft ON summaries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION summer_check_summary_permissions();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER summary_permissions_keep_one
  AFTER DELETE OR UPDATE ON summary_permissions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION summer_check_summary_permissions();
--> statement-breakpoint

-- Every collection must keep at least one viewing permission.
CREATE FUNCTION summer_check_collection_permissions() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cid uuid;
BEGIN
  IF TG_TABLE_NAME = 'collections' THEN cid := NEW.id; ELSE cid := OLD.collection_id; END IF;
  IF EXISTS (SELECT 1 FROM collections c WHERE c.id = cid)
     AND NOT EXISTS (SELECT 1 FROM collection_permissions cp WHERE cp.collection_id = cid) THEN
    RAISE EXCEPTION 'collection % must have at least one permission', cid USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER collections_require_permission
  AFTER INSERT ON collections
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION summer_check_collection_permissions();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER collection_permissions_keep_one
  AFTER DELETE OR UPDATE ON collection_permissions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION summer_check_collection_permissions();
