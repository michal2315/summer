import { eq, sql } from 'drizzle-orm';
import { htmlToText } from '../../common/html';
import { Db } from '../client';
import * as s from '../schema';
import { DEV_IDENTITIES, DEV_ISSUER } from './identities';

/**
 * Deterministic, non-sensitive dev/test fixtures — a port of the client's mock-db seed so the UI looks the same
 * against the real server. Wipes every application table first.
 */

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const COURSES = [
  { name: 'מבוא לאלגוריתמים', group: 'cs-faculty', topics: ['תכנון דינמי', 'אלגוריתמים חמדניים', 'גרפים ומסלולים קצרים', 'מיון וחיפוש', 'זרימה ברשתות', 'NP-שלמות'] },
  { name: 'מבני נתונים', group: 'cs-faculty', topics: ['עצי AVL', 'טבלאות גיבוב', 'ערימות', 'עצי B', 'Union-Find', 'רשימות דילוג'] },
  { name: 'חדו"א 1', group: 'math-faculty', topics: ['גבולות ורציפות', 'נגזרות', 'משפט לגרנז׳', 'אינטגרלים', 'טורי טיילור', 'סדרות'] },
  { name: 'אלגברה לינארית', group: 'math-faculty', topics: ['מרחבים וקטוריים', 'העתקות לינאריות', 'דטרמיננטות', 'ערכים עצמיים', 'לכסון', 'מכפלה פנימית'] },
  { name: 'מבוא לפסיכולוגיה', group: 'behavioral', topics: ['זיכרון', 'למידה והתניה', 'תפיסה', 'מוטיבציה', 'התפתחות', 'אישיות'] },
  { name: 'מערכות הפעלה', group: 'cs-faculty', topics: ['תהליכים ותהליכונים', 'תזמון', 'סנכרון', 'זיכרון וירטואלי', 'מערכות קבצים', 'קיפאון'] },
];

const DEPARTMENT: Record<string, string> = { 'cs-faculty': 'מדעי המחשב', 'math-faculty': 'מתמטיקה', behavioral: 'מדעי ההתנהגות' };

const PARAGRAPHS = [
  'בהרצאה עברנו על ההגדרות הבסיסיות והדגמנו אותן על מספר דוגמאות מהתרגול.',
  'הנקודה החשובה ביותר: יש להבין את <strong>האינטואיציה</strong> לפני שניגשים להוכחה הפורמלית.',
  'המרצה הדגיש שהנושא הזה מופיע כמעט בכל מבחן, בדרך כלל בשאלה הראשונה.',
  'כדאי לחזור על הדוגמה מהשקפים — היא ממחישה בדיוק את המקרה הקצה.',
  'סיבוכיות הזמן היא <em>O(n log n)</em> במקרה הממוצע ו-<em>O(n²)</em> במקרה הגרוע.',
  'בסוף השיעור הוצגה שאלה ממבחן קודם, הפתרון המלא מופיע בקובץ המצורף.',
  'שימו לב להבדל בין ההגדרה בספר לבין ההגדרה שניתנה בכיתה.',
];

const LABELS = ['מועד א׳', 'מועד ב׳', 'חומר למבחן', 'תרגול', 'הוכחות', 'דוגמאות', 'שקפים', 'חזרה', 'חשוב', 'בונוס'];
const COLORS = ['#fe9eae', '#ff0000', '#ffa500', '#008000', '#00b2b2', '#0000c9', '#800080', '#808080'];
const COMMENTS = ['תודה רבה! עזר מאוד 🙏', 'יש טעות קטנה בהגדרה בפסקה השנייה', 'מישהו יודע אם זה בחומר למבחן?', 'סיכום מעולה', '@dlevi תסתכלי על זה'];

const TABLES = [
  'legacy_releases', 'legacy_collections', 'folder_summaries', 'folder_editors', 'folder_permissions', 'folders',
  'notifications', 'query_alert_hits', 'query_alerts', 'queries', 'whats_new_seen', 'user_pinned_permissions', 'user_fav_labels',
  'user_pinned_labels', 'user_fav_summaries', 'user_follows',
  'comments', 'summary_files',
  'summary_seen', 'summary_tagged_users', 'summary_tagged_permissions', 'summary_fields', 'summary_labels', 'summary_editors', 'summary_permissions',
  'summaries', 'labels', 'content_type_fields', 'content_types', 'fields', 'permissions', 'users',
];

export async function seed(db: Db, now = Date.now()): Promise<void> {
  const r = rng(42);
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(r() * arr.length)];
  const some = <T>(arr: readonly T[], max: number) => [...new Set(Array.from({ length: Math.floor(r() * (max + 1)) }, () => pick(arr)))];
  const DAY = 86_400_000;

  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`));

    const users = await tx
      .insert(s.users)
      .values(
        DEV_IDENTITIES.map((i) => ({
          authIssuer: DEV_ISSUER,
          authSubject: i.username,
          username: i.username,
          fullName: i.fullName,
          department: i.department,
          email: i.email,
          isSystem: i.isSystem ?? false,
          lastGroupKeys: [...i.groups].sort(),
        })),
      )
      .returning();
    const user = (username: string) => users.find((u) => u.username === username)!;
    const groupsOf = (username: string) => DEV_IDENTITIES.find((i) => i.username === username)!.groups;

    const permissions = await tx
      .insert(s.permissions)
      .values([
        { name: 'הפקולטה למדעי המחשב', groupName: 'cs-faculty', color: '#0000c9' },
        { name: 'הפקולטה למתמטיקה', groupName: 'math-faculty', color: '#008000' },
        { name: 'מדעי ההתנהגות', groupName: 'behavioral', color: '#800080' },
        { name: 'סטודנטים שנה א׳', groupName: 'year-1', color: '#ffa500' },
        { name: 'סגל אקדמי', groupName: 'staff', color: '#ff0000' },
        { name: 'תבור', groupName: 'tavor', color: '#8b5a2b' },
        { name: 'צוות מחקר', groupName: 'research', color: '#00b2b2' },
        { name: 'ועדת בחינות', groupName: 'exams-committee', color: '#fe9eae' },
        { name: 'תואר שני', groupName: 'graduate', color: '#808080' },
        { name: 'מעבדת ביולוגיה', groupName: 'bio-lab', color: '#2e8b57' },
        { name: 'חסוי — הנהלה', groupName: 'management', color: '#4b0082' },
      ])
      .returning();
    const perm = (group: string) => permissions.find((p) => p.groupName === group)!.id;

    const fields = await tx
      .insert(s.fields)
      .values([
        { name: 'שם הקורס', type: 'string' as const },
        { name: 'מרצה', type: 'string' as const },
        { name: 'מספר הרצאה', type: 'number' as const },
        { name: 'קישור', type: 'string' as const },
        { name: 'משך (דקות)', type: 'number' as const },
        { name: 'שם הספר', type: 'string' as const },
        { name: 'פרק', type: 'number' as const },
        { name: 'ISBN', type: 'string' as const },
        { name: 'כתב עת', type: 'string' as const },
        { name: 'תאריך הגשה', type: 'date' as const },
        { name: 'שעת קבלה', type: 'hour' as const },
        { name: 'תגיות', type: 'array' as const },
      ])
      .returning();
    const f = (n: number) => fields[n - 1].id;

    const typeDefs = [
      { name: 'lecture', displayName: 'שיעור', icon: 'lecture.svg', fields: [[1, true], [2, false], [3, false]] },
      { name: 'video', displayName: 'וידאו', icon: 'video.svg', fields: [[4, true], [5, false]] },
      { name: 'textbook', displayName: 'ספר', icon: 'book.svg', fields: [[6, true], [7, false], [8, false]] },
      { name: 'article', displayName: 'מאמר', icon: 'article.svg', fields: [[4, true], [9, false]] },
      { name: 'generic', displayName: 'כללי', icon: 'generic.svg', fields: [] },
    ] as const;
    const types = await tx
      .insert(s.contentTypes)
      .values(typeDefs.map((t, position) => ({ name: t.name, displayName: t.displayName, icon: t.icon, position })))
      .returning();
    const typeFieldRows = typeDefs.flatMap((t, i) =>
      t.fields.map(([n, required], position) => ({ contentTypeId: types[i].id, fieldId: f(n), required, position })),
    );
    await tx.insert(s.contentTypeFields).values(typeFieldRows);

    const labelRows = await tx
      .insert(s.labels)
      .values([...new Set([...LABELS, ...COURSES.map((c) => c.name)])].map((name) => ({ name })))
      .returning();
    const labelId = (name: string) => labelRows.find((l) => l.name === name)!.id;

    const mgolan = user('mgolan');

    const authors = users.filter((u) => !u.isSystem);
    const summaryIds: string[] = [];
    /** Published summaries of the first five courses, placed in their faculty folders below. */
    const courseSummaries = new Map<number, string[]>();
    const draftIds = new Set<string>();
    const isDraftAt = (i: number, authorId: string) => authorId === mgolan.id && i % 4 === 3;
    for (let i = 0; i < 48; i++) {
      const courseIdx = Math.floor(r() * COURSES.length);
      const course = COURSES[courseIdx];
      const topic = pick(course.topics);
      const extraYear1 = r() < 0.4;
      const required = [course.group, ...(extraYear1 ? ['year-1'] : [])];
      // Authors must hold the groups they assign (the API enforces this too).
      const eligible = authors.filter((a) => required.every((g) => groupsOf(a.username).includes(g)));
      const author = i < 4 && eligible.includes(mgolan) ? mgolan : pick(eligible.length ? eligible : [mgolan]);
      const type = r() < 0.6 ? types[0] : pick(types.slice(1));
      const eventAt = now - Math.floor(r() * 90) * DAY - Math.floor(r() * 8) * 3_600_000;
      const created = eventAt + Math.floor(r() * 3) * 3_600_000;
      const content =
        `<h2>${topic}</h2>` +
        some(PARAGRAPHS, 4)
          .map((p) => `<p>${p}</p>`)
          .join('') +
        (r() < 0.4 ? '<ul><li>הגדרה</li><li>משפט</li><li>דוגמה</li></ul>' : '');
      // Content used to end with a #label hashtag; keep its random draw so the rest of the seed (and the tests) stay the same.
      pick(LABELS);
      const notes = r() < 0.3 ? '<p>לבדוק שוב את ההוכחה בעמוד 3.</p>' : '';
      const fieldValues =
        type.name === 'lecture'
          ? [
              { fieldId: f(1), value: course.name },
              { fieldId: f(2), value: pick(["פרופ' יוסי אברהם", 'ד"ר רונית שחר', 'ד"ר אמיר גולן']) },
              { fieldId: f(3), value: String(1 + Math.floor(r() * 12)) },
            ]
          : type.name === 'video' || type.name === 'article'
            ? [{ fieldId: f(4), value: `https://example-university.edu/media/${1000 + i}` }]
            : type.name === 'textbook'
              ? [
                  { fieldId: f(6), value: `${course.name} — ספר הקורס` },
                  { fieldId: f(7), value: String(1 + Math.floor(r() * 10)) },
                ]
              : [];
      const commenters = some(authors, 3);
      const labels = [...new Set([course.name, ...some(LABELS, 3)])];
      const tagged = r() < 0.25 ? [pick(authors).id] : [];
      const inCourseFolder = courseIdx < 5 && r() < 0.6;
      const seenBy = some(authors, 4).map((u) => u.id);
      const color = r() < 0.35 ? pick(COLORS) : '';

      const [row] = await tx
        .insert(s.summaries)
        .values({
          title: `${course.name} — ${topic}`,
          contentHtml: content,
          contentText: htmlToText(content),
          notesHtml: notes,
          notesText: htmlToText(notes),
          department: DEPARTMENT[course.group],
          contentTypeId: type.id,
          isDraft: isDraftAt(i, author.id),
          eventDate: new Date(eventAt),
          eventHasTime: true,
          color,
          createdBy: author.id,
          createdAt: new Date(created),
          updatedAt: new Date(created + Math.floor(r() * 5) * DAY),
        })
        .returning({ id: s.summaries.id });
      const sid = row.id;
      summaryIds.push(sid);
      if (isDraftAt(i, author.id)) draftIds.add(sid);
      await tx.insert(s.summaryEditors).values({ summaryId: sid, userId: author.id });
      await tx.insert(s.summaryPermissions).values(required.map((g) => ({ summaryId: sid, permissionId: perm(g) })));
      await tx.insert(s.summaryLabels).values(labels.map((name, position) => ({ summaryId: sid, labelId: labelId(name), position })));
      if (fieldValues.length) await tx.insert(s.summaryFields).values(fieldValues.map((v) => ({ summaryId: sid, ...v })));
      if (tagged.length) await tx.insert(s.summaryTaggedUsers).values(tagged.map((userId) => ({ summaryId: sid, userId })));
      if (seenBy.length) await tx.insert(s.summarySeen).values(seenBy.map((userId) => ({ summaryId: sid, userId })));
      if (inCourseFolder && !draftIds.has(sid)) courseSummaries.set(courseIdx, [...(courseSummaries.get(courseIdx) ?? []), sid]);
      if (commenters.length)
        await tx.insert(s.comments).values(
          commenters.map((c, j) => ({
            summaryId: sid,
            content: pick(COMMENTS),
            createdBy: c.id,
            createdAt: new Date(created + (j + 1) * 3_600_000),
          })),
        );
    }

    // Hierarchy (mirrors the client mock's folders; every folder needs at least one permission here).
    const folderDefs: { key: string; name: string; parent: string | null; group: string; managers?: string[]; createdBy?: string }[] = [
      { key: 'fd1', name: 'שנה א׳', parent: null, group: 'year-1' },
      { key: 'fd2', name: 'סמסטר א׳', parent: 'fd1', group: 'year-1' },
      { key: 'fd3', name: 'סמסטר ב׳', parent: 'fd1', group: 'year-1' },
      { key: 'fd4', name: 'מדעי המחשב', parent: 'fd2', group: 'cs-faculty' },
      { key: 'fd5', name: 'מתמטיקה', parent: 'fd2', group: 'math-faculty', managers: ['mgolan', 'yavraham'] },
      { key: 'fd6', name: 'מדעי ההתנהגות', parent: 'fd2', group: 'behavioral', managers: ['nmizrahi'], createdBy: 'nmizrahi' },
      // Visible to mgolan (staff) but managed by someone else — read-only for her.
      { key: 'fd7', name: 'חומרי הוראה לסגל', parent: null, group: 'staff', managers: ['yavraham'], createdBy: 'yavraham' },
    ];
    const folderIds = new Map<string, string>();
    for (const d of folderDefs) {
      const [row] = await tx
        .insert(s.folders)
        .values({
          name: d.name,
          parentId: d.parent ? folderIds.get(d.parent)! : null,
          createdBy: user(d.createdBy ?? 'mgolan').id,
          createdAt: new Date(now - 60 * DAY),
          updatedAt: new Date(now - 5 * DAY),
        })
        .returning({ id: s.folders.id });
      folderIds.set(d.key, row.id);
      await tx.insert(s.folderPermissions).values({ folderId: row.id, permissionId: perm(d.group) });
      await tx.insert(s.folderEditors).values((d.managers ?? ['mgolan']).map((u) => ({ folderId: row.id, userId: user(u).id })));
    }
    const place = async (key: string, courseIdx: number[], summaryIdx: number[]) => {
      const folderId = folderIds.get(key)!;
      const ids = [...courseIdx.flatMap((c) => courseSummaries.get(c) ?? []), ...summaryIdx.map((i) => summaryIds[i])].filter((sid) => !draftIds.has(sid));
      // A summary may sit in several folders; placing it twice in one folder is a no-op.
      for (const summaryId of ids) await tx.insert(s.folderSummaries).values({ folderId, summaryId }).onConflictDoNothing();
    };
    await place('fd4', [0, 1], [0, 1]);
    await place('fd5', [2, 3], []);
    await place('fd6', [4], []);
    await place('fd1', [], [2]);
    await place('fd7', [], [4, 5]);

    // Collections from the old Summer, waiting in the legacy root to be sorted on /staging (no permissions, no
    // managers on the root itself). Some summaries sit in two collections; the last one is someone else's to sort.
    const [legacyRoot] = await tx
      .insert(s.folders)
      .values({ name: 'לקטים מ-Summer הישן', parentId: null, createdBy: user('summer').id, isLegacyRoot: true, createdAt: new Date(now - 30 * DAY) })
      .returning({ id: s.folders.id });
    const legacyDefs: { name: string; group: string; managers: string[]; summaries: number[] }[] = [
      { name: 'סיכומי הרצאות', group: 'year-1', managers: ['mgolan'], summaries: [0, 1, 2, 3, 6, 7, 8, 9] },
      { name: 'למבחן', group: 'year-1', managers: ['mgolan', 'yavraham'], summaries: [2, 3, 10, 11, 12] },
      { name: 'תרגולים', group: 'cs-faculty', managers: ['mgolan'], summaries: [13, 14, 15] },
      { name: 'ארכיון סגל', group: 'staff', managers: ['yavraham'], summaries: [4, 5, 16] },
    ];
    for (const d of legacyDefs) {
      const [row] = await tx
        .insert(s.folders)
        .values({ name: d.name, parentId: legacyRoot.id, createdBy: user('summer').id, createdAt: new Date(now - 30 * DAY) })
        .returning({ id: s.folders.id });
      await tx.insert(s.folderPermissions).values({ folderId: row.id, permissionId: perm(d.group) });
      await tx.insert(s.folderEditors).values(d.managers.map((u) => ({ folderId: row.id, userId: user(u).id })));
      for (const i of d.summaries)
        if (summaryIds[i] && !draftIds.has(summaryIds[i])) await tx.insert(s.folderSummaries).values({ folderId: row.id, summaryId: summaryIds[i] }).onConflictDoNothing();
    }

    // A running summary (תמצית רצף) with three sumaroons (תמציתוניות), one per paragraph of the chapter.
    const textbook = types.find((t) => t.name === 'textbook')!;
    const day = (offset: number) => new Date(now + offset * DAY).toISOString().slice(0, 10);
    const [running] = await tx
      .insert(s.summaries)
      .values({
        kind: 'running',
        title: 'מבני נתונים — ספר הקורס, פרק 3: עצי חיפוש',
        contentHtml: '<p>סיכום רציף של פרק 3 בספר הקורס, פסקה אחר פסקה.</p>',
        contentText: 'סיכום רציף של פרק 3 בספר הקורס, פסקה אחר פסקה.',
        department: DEPARTMENT['cs-faculty'],
        contentTypeId: textbook.id,
        rangeStart: day(-40),
        rangeEnd: day(1),
        createdBy: mgolan.id,
        createdAt: new Date(now - 40 * DAY),
        updatedAt: new Date(now - 10 * DAY),
      })
      .returning({ id: s.summaries.id });
    await tx.insert(s.summaryEditors).values({ summaryId: running.id, userId: mgolan.id });
    await tx.insert(s.summaryPermissions).values({ summaryId: running.id, permissionId: perm('cs-faculty') });
    await tx.insert(s.summaryLabels).values(['מבני נתונים', 'חומר למבחן'].map((name, position) => ({ summaryId: running.id, labelId: labelId(name), position })));
    await tx.insert(s.summaryFields).values([
      { summaryId: running.id, fieldId: f(6), value: 'מבני נתונים — ספר הקורס' },
      { summaryId: running.id, fieldId: f(7), value: '3' },
    ]);
    const paragraphs = [
      { title: '3.1 עצי חיפוש בינאריים', author: 'mgolan', offset: -30, extra: [] as string[] },
      { title: '3.2 סיבובים', author: 'dlevi', offset: -20, extra: [] as string[] },
      { title: '3.3 עצי AVL', author: 'mgolan', offset: -10, extra: ['year-1'] },
    ];
    for (const p of paragraphs) {
      const html = `<p>${pick(PARAGRAPHS)}</p>`;
      const [row] = await tx
        .insert(s.summaries)
        .values({
          kind: 'sumaroon',
          parentId: running.id,
          title: p.title,
          contentHtml: html,
          contentText: htmlToText(html),
          department: DEPARTMENT['cs-faculty'],
          contentTypeId: textbook.id,
          eventDate: new Date(now + p.offset * DAY),
          eventHasTime: true,
          link: `https://example-university.edu/books/ds/ch3#${p.title.split(' ')[0]}`,
          createdBy: user(p.author).id,
          createdAt: new Date(now + p.offset * DAY + 3_600_000),
          updatedAt: new Date(now + p.offset * DAY + 3_600_000),
        })
        .returning({ id: s.summaries.id });
      await tx.insert(s.summaryEditors).values({ summaryId: row.id, userId: user(p.author).id });
      if (p.extra.length) await tx.insert(s.summaryPermissions).values(p.extra.map((g) => ({ summaryId: row.id, permissionId: perm(g) })));
      await tx.insert(s.summaryFields).values({ summaryId: row.id, fieldId: f(6), value: 'מבני נתונים — ספר הקורס' });
    }

    await tx.insert(s.userFollows).values({ followerId: mgolan.id, followedId: user('dlevi').id });
    await tx.insert(s.userPinnedLabels).values({ userId: mgolan.id, labelId: labelId('חומר למבחן') });
    await tx.insert(s.userFavLabels).values({ userId: mgolan.id, labelId: labelId('חשוב') });
    await tx.insert(s.userFavSummaries).values([4, 8, 13].map((i) => ({ userId: mgolan.id, summaryId: summaryIds[i] })));

    await tx.insert(s.notifications).values([
      { userId: mgolan.id, summaryId: summaryIds[6], text: 'דנה לוי תייגה אותך בסיכום', kind: 'tag', createdBy: user('dlevi').id, createdAt: new Date(now - 2 * 3_600_000) },
      { userId: mgolan.id, summaryId: summaryIds[0], text: 'תגובה חדשה על הסיכום שלך', kind: 'comment', createdBy: user('aperetz').id, createdAt: new Date(now - 26 * 3_600_000) },
      { userId: mgolan.id, summaryId: summaryIds[11], text: 'סיכום חדש נוסף לאוסף', kind: 'follow', createdAt: new Date(now - 4 * DAY), viewedAt: new Date(now - 3 * DAY) },
    ]);

    // Queries (saved searches) of mgolan's, some with alerts. Catalog fields go in the advanced tree as `field: 'field'`.
    const group = (op: 'AND' | 'OR', ...children: Record<string, unknown>[]) => ({ type: 'group', op, children });
    const cond = (c: Record<string, unknown>) => ({ type: 'cond', words: [], values: [], ...c });
    const queryDefs: {
      name: string;
      kind: 'simple' | 'advanced';
      search: Record<string, unknown>;
      isFavorite?: boolean;
      isShared?: boolean;
      alert?: { isActive: boolean; isMail: boolean; isDigest: boolean };
      daysAgo: number;
    }[] = [
      {
        name: 'הרצאות חדשות במבני נתונים',
        kind: 'advanced',
        search: { query: group('AND', cond({ field: 'field', fieldId: f(1), op: 'all', words: ['מבני נתונים'] }), cond({ field: 'contentType', op: 'isOneOf', values: ['lecture'] })) },
        alert: { isActive: true, isMail: false, isDigest: true },
        daysAgo: 30,
      },
      {
        name: 'חומר למבחן',
        kind: 'simple',
        search: { text: 'מבחן', labels: ['חומר למבחן'] },
        isFavorite: true,
        isShared: true,
        alert: { isActive: true, isMail: true, isDigest: false },
        daysAgo: 21,
      },
      { name: 'התמציות של דנה לוי', kind: 'simple', search: { text: '⁣@dlevi', sort: '-creationDate' }, daysAgo: 14 },
      {
        name: 'הרצאות 1–5 באלגוריתמים',
        kind: 'advanced',
        search: { query: group('AND', cond({ field: 'field', fieldId: f(1), op: 'all', words: ['אלגוריתמים'] }), cond({ field: 'field', fieldId: f(3), op: 'range', from: '1', to: '5' })) },
        alert: { isActive: false, isMail: false, isDigest: false },
        daysAgo: 10,
      },
      { name: 'סיבוכיות', kind: 'simple', search: { text: '"סיבוכיות"' }, isFavorite: true, isShared: true, daysAgo: 7 },
      {
        name: 'גרפים או עצים בכותרת',
        kind: 'advanced',
        search: { query: group('OR', cond({ field: 'title', op: 'any', words: ['גרפים', 'עצי'] }), cond({ field: 'labels', op: 'all', words: ['הוכחות'] })) },
        daysAgo: 5,
      },
      {
        name: 'ירוקות או כתומות מ־3 החודשים האחרונים',
        kind: 'advanced',
        search: { query: group('AND', cond({ field: 'color', op: 'isOneOf', values: ['#008000', '#ffa500'] }), cond({ field: 'createdDate', op: 'after', from: new Date(now - 90 * DAY).toISOString() })) },
        alert: { isActive: true, isMail: false, isDigest: false },
        daysAgo: 2,
      },
      { name: 'פסיכולוגיה — זיכרון', kind: 'simple', search: { text: 'זיכרון', contentTypes: ['lecture', 'textbook'] }, daysAgo: 1 },
    ];
    const alertIds = new Map<string, string>();
    for (const q of queryDefs) {
      const at = new Date(now - q.daysAgo * DAY);
      const [row] = await tx
        .insert(s.queries)
        .values({ ownerId: mgolan.id, name: q.name, kind: q.kind, search: q.search, isFavorite: q.isFavorite ?? false, isShared: q.isShared ?? false, createdAt: at, updatedAt: at })
        .returning({ id: s.queries.id });
      if (!q.alert) continue;
      const [alert] = await tx.insert(s.queryAlerts).values({ queryId: row.id, userId: mgolan.id, ...q.alert, createdAt: at, updatedAt: at }).returning({ id: s.queryAlerts.id });
      alertIds.set(q.name, alert.id);
    }

    // Others' queries, some shared (the queries page's "shared" tab); mgolan follows one, and dlevi follows mgolan's.
    const othersDefs: { owner: string; name: string; kind: 'simple' | 'advanced'; search: Record<string, unknown>; isShared: boolean; followedBy?: string[]; daysAgo: number }[] = [
      { owner: 'dlevi', name: 'תכנון דינמי — כל החומר', kind: 'simple', search: { text: '"תכנון דינמי"' }, isShared: true, followedBy: ['mgolan', 'aperetz'], daysAgo: 12 },
      { owner: 'dlevi', name: 'טבלאות גיבוב', kind: 'simple', search: { text: 'גיבוב' }, isShared: true, daysAgo: 6 },
      { owner: 'dlevi', name: 'הטיוטות שלי', kind: 'simple', search: { text: 'טיוטה' }, isShared: false, daysAgo: 3 },
      {
        owner: 'yavraham',
        name: 'אלגברה לינארית — ערכים עצמיים ולכסון',
        kind: 'advanced',
        search: { query: group('OR', cond({ field: 'title', op: 'any', words: ['עצמיים', 'לכסון'] }), cond({ field: 'text', op: 'all', words: ['ערכים עצמיים'] })) },
        isShared: true,
        followedBy: ['sbiton'],
        daysAgo: 9,
      },
      { owner: 'nmizrahi', name: 'למידה והתניה', kind: 'simple', search: { text: 'התניה' }, isShared: true, daysAgo: 4 },
      { owner: 'aperetz', name: 'מערכות הפעלה — סנכרון וקיפאון', kind: 'simple', search: { text: 'סנכרון או קיפאון' }, isShared: true, daysAgo: 2 },
    ];
    for (const q of othersDefs) {
      const at = new Date(now - q.daysAgo * DAY);
      const [row] = await tx
        .insert(s.queries)
        .values({ ownerId: user(q.owner).id, name: q.name, kind: q.kind, search: q.search, isShared: q.isShared, createdAt: at, updatedAt: at })
        .returning({ id: s.queries.id });
      for (const u of q.followedBy ?? []) await tx.insert(s.queryAlerts).values({ queryId: row.id, userId: user(u).id, isActive: true, createdAt: at, updatedAt: at });
    }
    const [exam] = await tx.select({ id: s.queries.id }).from(s.queries).where(eq(s.queries.name, 'חומר למבחן'));
    await tx.insert(s.queryAlerts).values({ queryId: exam.id, userId: user('dlevi').id, isActive: true });

    // A couple of alert notifications, so the notifications page shows them by query.
    const alerted = [
      { query: 'חומר למבחן', summary: summaryIds[2], hoursAgo: 5 },
      { query: 'ירוקות או כתומות מ־3 החודשים האחרונים', summary: summaryIds[39], hoursAgo: 30 },
      { query: 'הרצאות חדשות במבני נתונים', summary: summaryIds[6], hoursAgo: 52 },
    ];
    for (const a of alerted) {
      const alertId = alertIds.get(a.query)!;
      await tx.insert(s.notifications).values({ userId: mgolan.id, summaryId: a.summary, text: `תמצית חדשה תואמת לחיפוש "${a.query}"`, kind: 'alert', alertId, createdAt: new Date(now - a.hoursAgo * 3_600_000) });
      await tx.insert(s.queryAlertHits).values({ alertId, summaryId: a.summary });
    }
  });
}
