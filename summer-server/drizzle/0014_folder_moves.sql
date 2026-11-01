-- Folders can be moved (POST /folder/:id/move). The service serializes moves and rejects cycles.
DROP TRIGGER folders_parent_immutable ON folders;--> statement-breakpoint
DROP FUNCTION summer_folder_parent_immutable();
