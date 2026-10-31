CREATE TABLE "notification_rule_hits" (
	"rule_id" uuid NOT NULL,
	"summary_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_rule_hits_rule_id_summary_id_pk" PRIMARY KEY("rule_id","summary_id")
);
--> statement-breakpoint
ALTER TABLE "notification_rules" ADD COLUMN "match_any" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_rules" ADD COLUMN "search" jsonb;--> statement-breakpoint
ALTER TABLE "notification_rule_hits" ADD CONSTRAINT "notification_rule_hits_rule_id_notification_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."notification_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_rule_hits" ADD CONSTRAINT "notification_rule_hits_summary_id_summaries_id_fk" FOREIGN KEY ("summary_id") REFERENCES "public"."summaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_rule_hits_summary_id_index" ON "notification_rule_hits" USING btree ("summary_id");