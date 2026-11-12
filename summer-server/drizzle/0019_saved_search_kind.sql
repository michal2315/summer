ALTER TABLE "user_pinned_searches" ADD COLUMN "kind" text DEFAULT 'simple' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_pinned_searches" ADD COLUMN "is_favorite" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Searches saved before the kind existed: those with an advanced query tree came from the advanced panel.
UPDATE "user_pinned_searches" SET "kind" = 'advanced' WHERE "search" ? 'query';--> statement-breakpoint
ALTER TABLE "user_pinned_searches" ADD CONSTRAINT "user_pinned_searches_kind" CHECK ("user_pinned_searches"."kind" in ('simple', 'advanced'));
