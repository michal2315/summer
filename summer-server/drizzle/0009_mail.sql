ALTER TABLE "users" ADD COLUMN "mail_alerts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mail_activity" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_rules" ADD COLUMN "is_digest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "rule_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "mail" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "digest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "mail_attempts" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_rule_id_notification_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."notification_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_mail_pending_index" ON "notifications" USING btree ("created_at") WHERE "notifications"."mail";--> statement-breakpoint
CREATE INDEX "notifications_digest_pending_index" ON "notifications" USING btree ("created_at") WHERE "notifications"."digest";