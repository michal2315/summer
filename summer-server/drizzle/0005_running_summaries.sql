CREATE TYPE "public"."summary_kind" AS ENUM('summary', 'running', 'sumaroon');--> statement-breakpoint
ALTER TABLE "summaries" ADD COLUMN "kind" "summary_kind" DEFAULT 'summary' NOT NULL;--> statement-breakpoint
ALTER TABLE "summaries" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "summaries" ADD COLUMN "range_start" date;--> statement-breakpoint
ALTER TABLE "summaries" ADD COLUMN "range_end" date;--> statement-breakpoint
ALTER TABLE "summaries" ADD COLUMN "link" text;--> statement-breakpoint
ALTER TABLE "summaries" ADD CONSTRAINT "summaries_parent_id_summaries_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."summaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "summaries_parent_idx" ON "summaries" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "summaries" ADD CONSTRAINT "summaries_sumaroon_has_parent" CHECK (("summaries"."kind" = 'sumaroon') = ("summaries"."parent_id" is not null));--> statement-breakpoint
ALTER TABLE "summaries" ADD CONSTRAINT "summaries_range_only_running" CHECK (case when "summaries"."kind" = 'running' then "summaries"."range_start" is not null and "summaries"."range_end" is not null and "summaries"."range_start" <= "summaries"."range_end"
               else "summaries"."range_start" is null and "summaries"."range_end" is null end);--> statement-breakpoint
ALTER TABLE "summaries" ADD CONSTRAINT "summaries_link_only_sumaroon" CHECK ("summaries"."kind" = 'sumaroon' or "summaries"."link" is null);