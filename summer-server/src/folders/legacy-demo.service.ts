import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { htmlToText } from '../common/html';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DatabaseService } from '../database/database.service';

/** Marks the demo summaries (in their content), so a reset finds them and nothing else. */
const MARK = 'סיכום שהועבר מ-Summer הישן.';
const ROOT_NAME = 'לקטים מ-Summer הישן';

const COLLECTIONS = [
  { key: 'algo', name: 'סיכומי הרצאות — אלגוריתמים', group: 'cs-faculty', managers: ['mgolan'] },
  { key: 'exam', name: 'חומר למבחן', group: 'year-1', managers: ['mgolan', 'dlevi'] },
  { key: 'calc', name: 'תרגולים בחדו"א', group: 'math-faculty', managers: ['mgolan', 'yavraham'] },
  { key: 'papers', name: 'מאמרים שאהבתי', group: 'research', managers: ['mgolan'] },
  { key: 'lab', name: 'קבוצת מחקר', group: 'cs-faculty', managers: ['mgolan'] },
  { key: 'staff', name: 'ארכיון סגל', group: 'staff', managers: ['yavraham'] },
];

/** [title, author, permission groups, collections it sits in, a new folder it is already in] */
const SUMMARIES: [string, string, string[], string[], string?][] = [
  ['מיון מהיר — ניתוח המקרה הממוצע', 'mgolan', ['cs-faculty'], ['algo', 'exam']],
  ['ערימות ותורי עדיפויות', 'dlevi', ['cs-faculty'], ['algo']],
  ['אלגוריתם דייקסטרה', 'aperetz', ['cs-faculty'], ['algo', 'exam']],
  ['תכנון דינמי — בעיית התרמיל', 'mgolan', ['cs-faculty'], ['algo']],
  ['עצי חיפוש בינאריים מאוזנים', 'efriedman', ['cs-faculty'], ['algo']],
  ['גרפים — BFS ו-DFS', 'dlevi', ['cs-faculty', 'year-1'], ['algo']],
  ['טבלאות גיבוב', 'aperetz', ['cs-faculty'], ['algo']],
  ['זרימה ברשתות', 'mgolan', ['cs-faculty'], ['algo']],
  ['שאלות ממבחן 2025 מועד א׳', 'mgolan', ['year-1'], ['exam']],
  ['דף נוסחאות לבחינה', 'dlevi', ['year-1'], ['exam']],
  ['סיכום שבועות 1–6', 'nmizrahi', ['year-1'], ['exam']],
  ['טעויות נפוצות במבחן', 'aperetz', ['year-1'], ['exam']],
  ['פתרון מבחן לדוגמה', 'mgolan', ['year-1'], ['exam']],
  ['גבולות של סדרות — תרגול 3', 'sbiton', ['math-faculty'], ['calc']],
  ['נגזרות ונקודות קיצון', 'yavraham', ['math-faculty'], ['calc']],
  ['אינטגרלים מסוימים', 'sbiton', ['math-faculty'], ['calc']],
  ['טורי טיילור', 'mgolan', ['math-faculty'], ['calc']],
  ['משפט ערך הביניים', 'yavraham', ['math-faculty', 'year-1'], ['calc', 'exam']],
  ['Attention Is All You Need — סיכום', 'mgolan', ['research'], ['papers']],
  ['מודלים גנרטיביים — סקירה', 'dlevi', ['research'], ['papers']],
  ['למידת חיזוק — מושגי יסוד', 'mgolan', ['research'], ['papers'], 'מדעי המחשב'],
  ['ניסויים חוזרים במדעי המחשב', 'mgolan', ['research', 'cs-faculty'], ['papers', 'lab']],
  ['פרוטוקול הניסוי במעבדה', 'dlevi', ['bio-lab'], ['lab']],
  ['תוכנית עבודה לסמסטר', 'mgolan', ['cs-faculty'], ['lab']],
  ['נהלי בחינות לסגל', 'yavraham', ['staff'], ['staff']],
  ['פרוטוקול ישיבת סגל', 'yavraham', ['staff'], ['staff']],
];

const DAY = 86_400_000;

/**
 * DEV ONLY (refused when NODE_ENV=production): the staging page's demo. Resetting removes the legacy root, every
 * collection that was in it (wherever it is now), their progress rows and the demo summaries, then puts a fresh set
 * back: "sunrise" again. Folders and summaries that aren't the demo's are left alone.
 */
@Injectable()
export class LegacyDemoService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly database: DatabaseService,
  ) {}

  get enabled(): boolean {
    return this.config.env !== 'production';
  }

  async reset(): Promise<void> {
    if (!this.enabled) throw new ForbiddenException();
    await this.database.transaction(async () => {
      const db = this.database.db;
      const rows = async <T>(q: ReturnType<typeof sql>) => (await db.execute(q)).rows as T[];

      await db.execute(sql`delete from folders where id in (select folder_id from legacy_collections) or is_legacy_root`);
      await db.execute(sql`delete from legacy_collections`);
      await db.execute(sql`delete from summaries where content_html like ${'%' + MARK + '%'}`);

      const users = new Map((await rows<{ id: string; username: string }>(sql`select id, username from users`)).map((u) => [u.username, u.id]));
      const perms = new Map((await rows<{ id: string; group_name: string }>(sql`select id, group_name from permissions`)).map((p) => [p.group_name, p.id]));
      const [type] = await rows<{ id: string }>(sql`select id from content_types order by (name = 'lecture') desc, name limit 1`);
      const system = users.get('summer');
      if (!system || !type) throw new ForbiddenException('the demo needs the seeded users and content types');
      const monthAgo = new Date(Date.now() - 30 * DAY);

      const [root] = await rows<{ id: string }>(
        sql`insert into folders (name, created_by, is_legacy_root, created_at) values (${ROOT_NAME}, ${system}, true, ${monthAgo}) returning id`,
      );
      const ids = new Map<string, string>();
      for (const col of COLLECTIONS) {
        const perm = perms.get(col.group);
        const managers = col.managers.map((m) => users.get(m)).filter((u): u is string => !!u);
        if (!perm || !managers.length) continue;
        const [row] = await rows<{ id: string }>(
          sql`insert into folders (name, parent_id, created_by, created_at) values (${col.name}, ${root.id}, ${system}, ${monthAgo}) returning id`,
        );
        ids.set(col.key, row.id);
        await db.execute(sql`insert into folder_permissions (folder_id, permission_id) values (${row.id}, ${perm})`);
        for (const m of managers) await db.execute(sql`insert into folder_editors (folder_id, user_id) values (${row.id}, ${m})`);
      }

      let i = 0;
      for (const [title, author, groups, cols, alsoFolder] of SUMMARIES) {
        const authorId = users.get(author);
        const permIds = groups.map((g) => perms.get(g)).filter((p): p is string => !!p);
        if (!authorId || !permIds.length) continue;
        const html = `<h2>${title}</h2><p>${MARK} ההגדרות המרכזיות, דוגמה מהתרגול ונקודות לחזרה לפני המבחן.</p>`;
        const when = new Date(Date.now() - (40 + i++ * 3) * DAY);
        const [s] = await rows<{ id: string }>(sql`
          insert into summaries (title, content_html, content_text, content_type_id, created_by, event_date, created_at, updated_at)
          values (${title}, ${html}, ${htmlToText(html)}, ${type.id}, ${authorId}, ${when}, ${when}, ${when}) returning id`);
        await db.execute(sql`insert into summary_editors (summary_id, user_id) values (${s.id}, ${authorId})`);
        for (const p of permIds) await db.execute(sql`insert into summary_permissions (summary_id, permission_id) values (${s.id}, ${p})`);
        for (const k of cols) {
          const fid = ids.get(k);
          if (fid) await db.execute(sql`insert into folder_summaries (folder_id, summary_id) values (${fid}, ${s.id})`);
        }
        if (alsoFolder)
          await db.execute(sql`
            insert into folder_summaries (folder_id, summary_id)
            select id, ${s.id} from folders where name = ${alsoFolder} and not is_legacy_root limit 1
            on conflict do nothing`);
      }
    });
  }
}
