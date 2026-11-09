-- Collections are gone: summaries are organized only by hierarchy folders. Existing collection data is dropped.
DROP TABLE "collection_editors" CASCADE;--> statement-breakpoint
DROP TABLE "collection_permissions" CASCADE;--> statement-breakpoint
DROP TABLE "collections" CASCADE;--> statement-breakpoint
DROP TABLE "summary_collections" CASCADE;--> statement-breakpoint
DROP TABLE "folder_collections" CASCADE;--> statement-breakpoint
DROP TABLE "user_fav_collections" CASCADE;--> statement-breakpoint
DROP TABLE "user_pinned_collections" CASCADE;--> statement-breakpoint
DROP FUNCTION summer_check_collection_permissions();--> statement-breakpoint
DROP FUNCTION summer_check_collection_member();
