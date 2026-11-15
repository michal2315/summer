CREATE TABLE "queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'simple' NOT NULL,
	"search" jsonb NOT NULL,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "queries_kind" CHECK ("queries"."kind" in ('simple', 'advanced'))
);
--> statement-breakpoint
CREATE TABLE "query_alert_hits" (
	"alert_id" uuid NOT NULL,
	"summary_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "query_alert_hits_alert_id_summary_id_pk" PRIMARY KEY("alert_id","summary_id")
);
--> statement-breakpoint
CREATE TABLE "query_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_mail" boolean DEFAULT false NOT NULL,
	"is_digest" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "alert_id" uuid;--> statement-breakpoint
ALTER TABLE "queries" ADD CONSTRAINT "queries_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "query_alert_hits" ADD CONSTRAINT "query_alert_hits_alert_id_query_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."query_alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "query_alert_hits" ADD CONSTRAINT "query_alert_hits_summary_id_summaries_id_fk" FOREIGN KEY ("summary_id") REFERENCES "public"."summaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "query_alerts" ADD CONSTRAINT "query_alerts_query_id_queries_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."queries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "query_alerts" ADD CONSTRAINT "query_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "queries_owner_id_created_at_index" ON "queries" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "query_alert_hits_summary_id_index" ON "query_alert_hits" USING btree ("summary_id");--> statement-breakpoint
CREATE UNIQUE INDEX "query_alerts_query_id_user_id_index" ON "query_alerts" USING btree ("query_id","user_id");--> statement-breakpoint
CREATE INDEX "query_alerts_user_id_index" ON "query_alerts" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_alert_id_query_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."query_alerts"("id") ON DELETE set null ON UPDATE no action;