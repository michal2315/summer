-- Running summaries / sumaroons (תמצית רצף / תמציתונית).

-- A published sumaroon inherits its running summary's permissions, so it may have none of its own.
CREATE OR REPLACE FUNCTION summer_check_summary_permissions() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  sid uuid;
BEGIN
  -- IF, not CASE: PL/pgSQL only resolves NEW/OLD fields in the branch that runs.
  IF TG_TABLE_NAME = 'summaries' THEN sid := NEW.id; ELSE sid := OLD.summary_id; END IF;
  IF EXISTS (SELECT 1 FROM summaries s WHERE s.id = sid AND NOT s.is_draft AND s.kind <> 'sumaroon')
     AND NOT EXISTS (SELECT 1 FROM summary_permissions sp WHERE sp.summary_id = sid) THEN
    RAISE EXCEPTION 'published summary % must have at least one permission', sid USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint

-- A sumaroon's parent must be a running summary; kind and parent never change after creation.
CREATE FUNCTION summer_check_summary_kind() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.kind <> OLD.kind OR NEW.parent_id IS DISTINCT FROM OLD.parent_id) THEN
    RAISE EXCEPTION 'summary % kind and parent are immutable', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM summaries p WHERE p.id = NEW.parent_id AND p.kind = 'running') THEN
    RAISE EXCEPTION 'sumaroon % must belong to a running summary', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER summaries_kind_rules
  BEFORE INSERT OR UPDATE OF kind, parent_id ON summaries
  FOR EACH ROW EXECUTE FUNCTION summer_check_summary_kind();
--> statement-breakpoint

-- Sumaroons live only inside their running summary: never in a collection.
CREATE FUNCTION summer_check_collection_member() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM summaries s WHERE s.id = NEW.summary_id AND s.kind = 'sumaroon') THEN
    RAISE EXCEPTION 'sumaroon % cannot be added to a collection', NEW.summary_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER summary_collections_no_sumaroons
  BEFORE INSERT OR UPDATE ON summary_collections
  FOR EACH ROW EXECUTE FUNCTION summer_check_collection_member();
--> statement-breakpoint

-- …nor in a hierarchy folder.
CREATE FUNCTION summer_check_folder_member() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM summaries s WHERE s.id = NEW.summary_id AND s.kind = 'sumaroon') THEN
    RAISE EXCEPTION 'sumaroon % cannot be placed in a folder', NEW.summary_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER folder_summaries_no_sumaroons
  BEFORE INSERT OR UPDATE ON folder_summaries
  FOR EACH ROW EXECUTE FUNCTION summer_check_folder_member();
