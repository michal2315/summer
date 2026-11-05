CREATE TABLE "user_pinned_users" (
	"user_id" uuid NOT NULL,
	"pinned_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_pinned_users_user_id_pinned_user_id_pk" PRIMARY KEY("user_id","pinned_user_id"),
	CONSTRAINT "user_pinned_users_not_self" CHECK ("user_pinned_users"."user_id" <> "user_pinned_users"."pinned_user_id")
);
--> statement-breakpoint
ALTER TABLE "user_pinned_users" ADD CONSTRAINT "user_pinned_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_pinned_users" ADD CONSTRAINT "user_pinned_users_pinned_user_id_users_id_fk" FOREIGN KEY ("pinned_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;