CREATE TYPE "public"."field_type" AS ENUM('string', 'number', 'date', 'hour', 'array');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_issuer" text NOT NULL,
	"auth_subject" text NOT NULL,
	"username" text NOT NULL,
	"full_name" text NOT NULL,
	"department" text DEFAULT '' NOT NULL,
	"email" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_group_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_authIssuer_authSubject_unique" UNIQUE("auth_issuer","auth_subject")
);
--> statement-breakpoint
CREATE TABLE "content_type_fields" (
	"content_type_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "content_type_fields_content_type_id_field_id_pk" PRIMARY KEY("content_type_id","field_id")
);
--> statement-breakpoint
CREATE TABLE "content_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"icon" text,
	"color" text,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "content_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "field_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "labels_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"group_name" text NOT NULL,
	"color" text DEFAULT '#808080' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permissions_groupName_unique" UNIQUE("group_name")
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"summary_id" uuid NOT NULL,
	"content" text NOT NULL,
	"mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"content_html" text DEFAULT '' NOT NULL,
	"content_text" text DEFAULT '' NOT NULL,
	"notes_html" text DEFAULT '' NOT NULL,
	"notes_text" text DEFAULT '' NOT NULL,
	"department" text DEFAULT '' NOT NULL,
	"content_type_id" uuid NOT NULL,
	"is_draft" boolean DEFAULT false NOT NULL,
	"event_date" timestamp with time zone,
	"event_has_time" boolean DEFAULT false NOT NULL,
	"color" text DEFAULT '' NOT NULL,
	"timeline_title" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "summary_editors" (
	"summary_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "summary_editors_summary_id_user_id_pk" PRIMARY KEY("summary_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "summary_fields" (
	"summary_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "summary_fields_summary_id_field_id_pk" PRIMARY KEY("summary_id","field_id")
);
--> statement-breakpoint
CREATE TABLE "summary_files" (
	"summary_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"size" integer NOT NULL,
	"mime_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "summary_files_summary_id_file_name_pk" PRIMARY KEY("summary_id","file_name")
);
--> statement-breakpoint
CREATE TABLE "summary_labels" (
	"summary_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "summary_labels_summary_id_label_id_pk" PRIMARY KEY("summary_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "summary_permissions" (
	"summary_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	CONSTRAINT "summary_permissions_summary_id_permission_id_pk" PRIMARY KEY("summary_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "summary_seen" (
	"summary_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "summary_seen_summary_id_user_id_pk" PRIMARY KEY("summary_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "summary_tagged_users" (
	"summary_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "summary_tagged_users_summary_id_user_id_pk" PRIMARY KEY("summary_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "collection_editors" (
	"collection_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "collection_editors_collection_id_user_id_pk" PRIMARY KEY("collection_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "collection_permissions" (
	"collection_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	CONSTRAINT "collection_permissions_collection_id_permission_id_pk" PRIMARY KEY("collection_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "summary_collections" (
	"summary_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "summary_collections_summary_id_collection_id_pk" PRIMARY KEY("summary_id","collection_id")
);
--> statement-breakpoint
CREATE TABLE "user_fav_collections" (
	"user_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_fav_collections_user_id_collection_id_pk" PRIMARY KEY("user_id","collection_id")
);
--> statement-breakpoint
CREATE TABLE "user_fav_labels" (
	"user_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_fav_labels_user_id_label_id_pk" PRIMARY KEY("user_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "user_fav_summaries" (
	"user_id" uuid NOT NULL,
	"summary_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_fav_summaries_user_id_summary_id_pk" PRIMARY KEY("user_id","summary_id")
);
--> statement-breakpoint
CREATE TABLE "user_follows" (
	"follower_id" uuid NOT NULL,
	"followed_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_follows_follower_id_followed_id_pk" PRIMARY KEY("follower_id","followed_id"),
	CONSTRAINT "user_follows_not_self" CHECK ("user_follows"."follower_id" <> "user_follows"."followed_id")
);
--> statement-breakpoint
CREATE TABLE "user_pinned_collections" (
	"user_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_pinned_collections_user_id_collection_id_pk" PRIMARY KEY("user_id","collection_id")
);
--> statement-breakpoint
CREATE TABLE "user_pinned_labels" (
	"user_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_pinned_labels_user_id_label_id_pk" PRIMARY KEY("user_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "user_pinned_permissions" (
	"user_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_pinned_permissions_user_id_permission_id_pk" PRIMARY KEY("user_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "user_pinned_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"search" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whats_new_seen" (
	"user_id" uuid NOT NULL,
	"version" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whats_new_seen_user_id_version_pk" PRIMARY KEY("user_id","version")
);
--> statement-breakpoint
CREATE TABLE "notification_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"conditions" jsonb NOT NULL,
	"is_mail" boolean DEFAULT false NOT NULL,
	"is_notify" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"summary_id" uuid,
	"text" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"viewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "content_type_fields" ADD CONSTRAINT "content_type_fields_content_type_id_content_types_id_fk" FOREIGN KEY ("content_type_id") REFERENCES "public"."content_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_type_fields" ADD CONSTRAINT "content_type_fields_field_id_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."fields"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_summary_id_summaries_id_fk" FOREIGN KEY ("summary_id") REFERENCES "public"."summaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summaries" ADD CONSTRAINT "summaries_content_type_id_content_types_id_fk" FOREIGN KEY ("content_type_id") REFERENCES "public"."content_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summaries" ADD CONSTRAINT "summaries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_editors" ADD CONSTRAINT "summary_editors_summary_id_summaries_id_fk" FOREIGN KEY ("summary_id") REFERENCES "public"."summaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_editors" ADD CONSTRAINT "summary_editors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_fields" ADD CONSTRAINT "summary_fields_summary_id_summaries_id_fk" FOREIGN KEY ("summary_id") REFERENCES "public"."summaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_fields" ADD CONSTRAINT "summary_fields_field_id_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."fields"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_files" ADD CONSTRAINT "summary_files_summary_id_summaries_id_fk" FOREIGN KEY ("summary_id") REFERENCES "public"."summaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_labels" ADD CONSTRAINT "summary_labels_summary_id_summaries_id_fk" FOREIGN KEY ("summary_id") REFERENCES "public"."summaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_labels" ADD CONSTRAINT "summary_labels_label_id_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."labels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_permissions" ADD CONSTRAINT "summary_permissions_summary_id_summaries_id_fk" FOREIGN KEY ("summary_id") REFERENCES "public"."summaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_permissions" ADD CONSTRAINT "summary_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_seen" ADD CONSTRAINT "summary_seen_summary_id_summaries_id_fk" FOREIGN KEY ("summary_id") REFERENCES "public"."summaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_seen" ADD CONSTRAINT "summary_seen_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_tagged_users" ADD CONSTRAINT "summary_tagged_users_summary_id_summaries_id_fk" FOREIGN KEY ("summary_id") REFERENCES "public"."summaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_tagged_users" ADD CONSTRAINT "summary_tagged_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_editors" ADD CONSTRAINT "collection_editors_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_editors" ADD CONSTRAINT "collection_editors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_permissions" ADD CONSTRAINT "collection_permissions_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_permissions" ADD CONSTRAINT "collection_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_collections" ADD CONSTRAINT "summary_collections_summary_id_summaries_id_fk" FOREIGN KEY ("summary_id") REFERENCES "public"."summaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_collections" ADD CONSTRAINT "summary_collections_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_fav_collections" ADD CONSTRAINT "user_fav_collections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_fav_collections" ADD CONSTRAINT "user_fav_collections_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_fav_labels" ADD CONSTRAINT "user_fav_labels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_fav_labels" ADD CONSTRAINT "user_fav_labels_label_id_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_fav_summaries" ADD CONSTRAINT "user_fav_summaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_fav_summaries" ADD CONSTRAINT "user_fav_summaries_summary_id_summaries_id_fk" FOREIGN KEY ("summary_id") REFERENCES "public"."summaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_followed_id_users_id_fk" FOREIGN KEY ("followed_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_pinned_collections" ADD CONSTRAINT "user_pinned_collections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_pinned_collections" ADD CONSTRAINT "user_pinned_collections_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_pinned_labels" ADD CONSTRAINT "user_pinned_labels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_pinned_labels" ADD CONSTRAINT "user_pinned_labels_label_id_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_pinned_permissions" ADD CONSTRAINT "user_pinned_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_pinned_permissions" ADD CONSTRAINT "user_pinned_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_pinned_searches" ADD CONSTRAINT "user_pinned_searches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whats_new_seen" ADD CONSTRAINT "whats_new_seen_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_summary_id_summaries_id_fk" FOREIGN KEY ("summary_id") REFERENCES "public"."summaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "labels_name_trgm" ON "labels" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "comments_summary_id_created_at_index" ON "comments" USING btree ("summary_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_content_trgm" ON "comments" USING gin ("content" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "summaries_feed_idx" ON "summaries" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "summaries_event_idx" ON "summaries" USING btree ("event_date" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "summaries_author_idx" ON "summaries" USING btree ("created_by","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "summaries_content_type_idx" ON "summaries" USING btree ("content_type_id");--> statement-breakpoint
CREATE INDEX "summaries_title_trgm" ON "summaries" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "summaries_content_trgm" ON "summaries" USING gin ("content_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "summaries_notes_trgm" ON "summaries" USING gin ("notes_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "summary_editors_user_id_index" ON "summary_editors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "summary_fields_field_id_value_index" ON "summary_fields" USING btree ("field_id","value");--> statement-breakpoint
CREATE INDEX "summary_labels_label_id_index" ON "summary_labels" USING btree ("label_id");--> statement-breakpoint
CREATE INDEX "summary_permissions_permission_id_index" ON "summary_permissions" USING btree ("permission_id");--> statement-breakpoint
CREATE INDEX "summary_tagged_users_user_id_index" ON "summary_tagged_users" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "collection_editors_user_id_index" ON "collection_editors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "collection_permissions_permission_id_index" ON "collection_permissions" USING btree ("permission_id");--> statement-breakpoint
CREATE INDEX "summary_collections_collection_id_summary_id_index" ON "summary_collections" USING btree ("collection_id","summary_id");--> statement-breakpoint
CREATE INDEX "user_follows_followed_id_follower_id_index" ON "user_follows" USING btree ("followed_id","follower_id");--> statement-breakpoint
CREATE INDEX "user_pinned_searches_user_id_created_at_index" ON "user_pinned_searches" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_rules_user_id_index" ON "notification_rules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_user_id_created_at_id_index" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);