-- Every folder must keep at least one viewing permission (same rule as collections; deferred to COMMIT).
CREATE FUNCTION summer_check_folder_permissions() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  fid uuid;
BEGIN
  IF TG_TABLE_NAME = 'folders' THEN fid := NEW.id; ELSE fid := OLD.folder_id; END IF;
  IF EXISTS (SELECT 1 FROM folders f WHERE f.id = fid)
     AND NOT EXISTS (SELECT 1 FROM folder_permissions fp WHERE fp.folder_id = fid) THEN
    RAISE EXCEPTION 'folder % must have at least one permission', fid USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER folders_require_permission
  AFTER INSERT ON folders
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION summer_check_folder_permissions();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER folder_permissions_keep_one
  AFTER DELETE OR UPDATE ON folder_permissions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION summer_check_folder_permissions();
--> statement-breakpoint

-- A folder's parent is fixed at creation. Without moves no cycle can form; a future "move folder" feature must
-- replace this with a locked cycle check (handoff §14).
CREATE FUNCTION summer_folder_parent_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    RAISE EXCEPTION 'folder parent cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER folders_parent_immutable
  BEFORE UPDATE OF parent_id ON folders
  FOR EACH ROW EXECUTE FUNCTION summer_folder_parent_immutable();
