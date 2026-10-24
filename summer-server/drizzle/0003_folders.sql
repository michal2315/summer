CREATE TABLE "folder_collections" (
	"collection_id" uuid PRIMARY KEY NOT NULL,
	"folder_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folder_editors" (
	"folder_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "folder_editors_folder_id_user_id_pk" PRIMARY KEY("folder_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "folder_permissions" (
	"folder_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	CONSTRAINT "folder_permissions_folder_id_permission_id_pk" PRIMARY KEY("folder_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "folder_summaries" (
	"summary_id" uuid PRIMARY KEY NOT NULL,
	"folder_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "folders_not_own_parent" CHECK ("folders"."parent_id" <> "folders"."id")
);
--> statement-breakpoint
ALTER TABLE "folder_collections" ADD CONSTRAINT "folder_collections_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_collections" ADD CONSTRAINT "folder_collections_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_editors" ADD CONSTRAINT "folder_editors_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_editors" ADD CONSTRAINT "folder_editors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_permissions" ADD CONSTRAINT "folder_permissions_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_permissions" ADD CONSTRAINT "folder_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_summaries" ADD CONSTRAINT "folder_summaries_summary_id_summaries_id_fk" FOREIGN KEY ("summary_id") REFERENCES "public"."summaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_summaries" ADD CONSTRAINT "folder_summaries_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_id_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "folder_collections_folder_id_index" ON "folder_collections" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "folder_editors_user_id_index" ON "folder_editors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "folder_permissions_permission_id_index" ON "folder_permissions" USING btree ("permission_id");--> statement-breakpoint
CREATE INDEX "folder_summaries_folder_id_index" ON "folder_summaries" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "folders_parent_id_index" ON "folders" USING btree ("parent_id");