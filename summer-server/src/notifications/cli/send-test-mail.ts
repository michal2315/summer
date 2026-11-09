import 'dotenv/config';
import { and, desc, eq, sql } from 'drizzle-orm';
import { loadConfig } from '../../config/app-config';
import { createDb } from '../../database/client';
import { contentTypes, labels, summaries, summaryLabels, users } from '../../database/schema';
import { MailItem, notificationMail } from '../mail-templates';
import { createMailer } from '../mailer';

/**
 * `npm run mail:test -- [to]`: a sample mention through the configured transport (MAIL_REDIRECT_TO still applies),
 * about the newest published summary, so every part of the design shows and the button opens a real summary.
 */
async function main() {
  const config = loadConfig();
  const to = process.argv[2] ?? config.mail.redirectTo ?? config.mail.fromAddress;
  if (!to) throw new Error('give an address: npm run mail:test -- someone@example.com');

  const { db, pool } = createDb(config.db.url, 1);
  let item: MailItem;
  try {
    const [s] = await db
      .select({
        id: summaries.id,
        title: summaries.title,
        contentText: summaries.contentText,
        eventDate: summaries.eventDate,
        eventHasTime: summaries.eventHasTime,
        contentType: contentTypes.displayName,
        author: users.fullName,
        labels: sql<string[]>`(select coalesce(array_agg(${labels.name} order by ${labels.name}), '{}') from ${summaryLabels} join ${labels} on ${labels.id} = ${summaryLabels.labelId} where ${summaryLabels.summaryId} = ${summaries.id})`,
      })
      .from(summaries)
      .leftJoin(contentTypes, eq(contentTypes.id, summaries.contentTypeId))
      .leftJoin(users, eq(users.id, summaries.createdBy))
      .where(and(eq(summaries.isDraft, false), eq(summaries.kind, 'summary')))
      .orderBy(desc(summaries.updatedAt))
      .limit(1);
    item = s
      ? {
          text: `בדיקה: ${s.author ?? 'Summer'} הזכיר/ה אותך בתגובה`,
          summaryId: s.id,
          summaryTitle: s.title,
          summary: { contentType: s.contentType, author: s.author, eventDate: s.eventDate, eventHasTime: s.eventHasTime, labels: s.labels, contentText: s.contentText },
          comment: 'זה מייל בדיקה מ-Summer. הכפתור למטה פותח את התמצית הזו.',
          actorName: s.author,
        }
      : { text: 'זה מייל בדיקה מ-Summer. אם הגיע, המיילים עובדים.', summaryId: null, summaryTitle: null };
  } finally {
    await pool.end();
  }

  await createMailer(config).send(notificationMail({ appUrl: config.appUrl, timezone: config.timezone }, to, item));
  console.log(`[mail:test] sent via ${config.mail.transport} to ${config.mail.redirectTo || to}${item.summaryId ? ` (about "${item.summaryTitle}")` : ''}`);
}

main().catch((e) => {
  console.error(`[mail:test] ${(e as Error).message}`);
  process.exit(1);
});
