CREATE TABLE "summary_tagged_permissions" (
	"summary_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	CONSTRAINT "summary_tagged_permissions_summary_id_permission_id_pk" PRIMARY KEY("summary_id","permission_id")
);
--> statement-breakpoint
ALTER TABLE "summary_tagged_permissions" ADD CONSTRAINT "summary_tagged_permissions_summary_id_summaries_id_fk" FOREIGN KEY ("summary_id") REFERENCES "public"."summaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "summary_tagged_permissions" ADD CONSTRAINT "summary_tagged_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "summary_tagged_permissions_permission_id_index" ON "summary_tagged_permissions" USING btree ("permission_id");