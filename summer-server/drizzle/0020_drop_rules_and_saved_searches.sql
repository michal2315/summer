ALTER TABLE "user_pinned_searches" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_rule_hits" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_rules" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "user_pinned_searches" CASCADE;--> statement-breakpoint
DROP TABLE "notification_rule_hits" CASCADE;--> statement-breakpoint
DROP TABLE "notification_rules" CASCADE;--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_rule_id_notification_rules_id_fk";
--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN "rule_id";--> statement-breakpoint
DELETE FROM "notifications" WHERE "kind" IN ('rule', 'search');