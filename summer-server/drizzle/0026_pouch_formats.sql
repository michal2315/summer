CREATE TABLE "pouch_format_members" (
	"format_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pouch_format_members_format_id_user_id_pk" PRIMARY KEY("format_id","user_id"),
	CONSTRAINT "pouch_format_members_role" CHECK ("pouch_format_members"."role" in ('viewer', 'editor'))
);
--> statement-breakpoint
CREATE TABLE "pouch_formats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mode" text DEFAULT 'perSummary' NOT NULL,
	"doc" jsonb NOT NULL,
	"page" jsonb NOT NULL,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pouch_formats_mode" CHECK ("pouch_formats"."mode" in ('perSummary', 'combined'))
);
--> statement-breakpoint
ALTER TABLE "pouch_format_members" ADD CONSTRAINT "pouch_format_members_format_id_pouch_formats_id_fk" FOREIGN KEY ("format_id") REFERENCES "public"."pouch_formats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pouch_format_members" ADD CONSTRAINT "pouch_format_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pouch_formats" ADD CONSTRAINT "pouch_formats_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pouch_format_members_user_id_index" ON "pouch_format_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pouch_formats_owner_id_created_at_index" ON "pouch_formats" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "pouch_formats_is_shared_updated_at_index" ON "pouch_formats" USING btree ("is_shared","updated_at");