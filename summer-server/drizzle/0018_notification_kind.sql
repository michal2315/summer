ALTER TABLE "notifications" ADD COLUMN "kind" text;--> statement-breakpoint
-- Backfill from what each row already carries (the rule, the comment) and, for the rest, the text the server wrote.
UPDATE "notifications" n SET "kind" = CASE
  WHEN r."id" IS NOT NULL THEN CASE WHEN r."search" IS NOT NULL THEN 'search' ELSE 'rule' END
  WHEN n."text" LIKE 'תמצית % תואמת לחיפוש %' THEN 'search'
  WHEN n."text" LIKE 'תמצית % תואמת לכלל %' THEN 'rule'
  WHEN n."comment_id" IS NOT NULL THEN CASE WHEN n."text" LIKE '%הגיב/ה על התמצית%' THEN 'comment' ELSE 'mention' END
  WHEN n."text" LIKE '%תייג/ה %' THEN 'tag'
  ELSE 'follow'
END
FROM "notifications" n2 LEFT JOIN "notification_rules" r ON r."id" = n2."rule_id"
WHERE n2."id" = n."id";--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "kind" SET NOT NULL;
