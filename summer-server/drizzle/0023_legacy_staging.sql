CREATE TABLE "legacy_collections" (
	"folder_id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"total" integer NOT NULL,
	"managers" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "legacy_releases" (
	"folder_id" uuid NOT NULL,
	"summary_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_releases_folder_id_summary_id_pk" PRIMARY KEY("folder_id","summary_id")
);
--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "is_legacy_root" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "legacy_releases" ADD CONSTRAINT "legacy_releases_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_releases" ADD CONSTRAINT "legacy_releases_summary_id_summaries_id_fk" FOREIGN KEY ("summary_id") REFERENCES "public"."summaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "folders_one_legacy_root" ON "folders" USING btree ("is_legacy_root") WHERE "folders"."is_legacy_root";--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_legacy_root_at_top" CHECK (not "folders"."is_legacy_root" or "folders"."parent_id" is null);--> statement-breakpoint
-- The legacy root is the one folder with no permissions: everyone sees it, and each collection in it keeps its own.
CREATE OR REPLACE FUNCTION summer_check_folder_permissions() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  fid uuid;
BEGIN
  IF TG_TABLE_NAME = 'folders' THEN fid := NEW.id; ELSE fid := OLD.folder_id; END IF;
  IF EXISTS (SELECT 1 FROM folders f WHERE f.id = fid AND NOT f.is_legacy_root)
     AND NOT EXISTS (SELECT 1 FROM folder_permissions fp WHERE fp.folder_id = fid) THEN
    RAISE EXCEPTION 'folder % must have at least one permission', fid USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
