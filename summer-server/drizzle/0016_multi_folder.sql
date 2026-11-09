-- A summary can sit in several folders (the same summary in each, not copies): the key becomes (summary, folder).
ALTER TABLE "folder_summaries" DROP CONSTRAINT "folder_summaries_pkey";--> statement-breakpoint
ALTER TABLE "folder_summaries" ADD CONSTRAINT "folder_summaries_summary_id_folder_id_pk" PRIMARY KEY("summary_id","folder_id");
