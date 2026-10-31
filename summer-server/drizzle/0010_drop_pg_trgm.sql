-- Substring search uses plain ILIKE; no trigram extension.
DROP INDEX "labels_name_trgm";--> statement-breakpoint
DROP INDEX "comments_content_trgm";--> statement-breakpoint
DROP INDEX "summaries_title_trgm";--> statement-breakpoint
DROP INDEX "summaries_content_trgm";--> statement-breakpoint
DROP INDEX "summaries_notes_trgm";--> statement-breakpoint
DROP EXTENSION IF EXISTS pg_trgm;
