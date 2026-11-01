import { randomUUID } from 'node:crypto';
import { htmlToText } from '../../common/html';
import { Db } from '../client';
import * as s from '../schema';
import { seed } from './seed';

/**
 * Bulk, randomised data for trying the app under a heavier load (`npm run db:seed:load`). Runs the regular dev
 * seed first (so the dev logins and fixtures still work), then adds a few thousand summaries of every kind,
 * custom fields and content types, and a nested folder tree. Deterministic for a given seed number.
 */

export interface LoadOptions {
  summaries: number;
  runningSummaries: number;
  seed: number;
}

export const DEFAULT_LOAD: LoadOptions = { summaries: 4000, runningSummaries: 40, seed: 7 };

const DEPARTMENTS = [
  { group: 'cs-faculty', name: 'מדעי המחשב', courses: ['מבוא למדעי המחשב', 'תכנות מונחה עצמים', 'רשתות תקשורת', 'בסיסי נתונים', 'קומפילציה', 'למידת מכונה', 'אבטחת מידע', 'גרפיקה ממוחשבת'] },
  { group: 'math-faculty', name: 'מתמטיקה', courses: ['חדו"א 2', 'מתמטיקה בדידה', 'הסתברות', 'סטטיסטיקה', 'משוואות דיפרנציאליות', 'תורת הגרפים', 'אנליזה נומרית'] },
  { group: 'behavioral', name: 'מדעי ההתנהגות', courses: ['פסיכולוגיה חברתית', 'שיטות מחקר', 'פסיכולוגיה קוגניטיבית', 'נוירופסיכולוגיה', 'סוציולוגיה'] },
  { group: 'ee-faculty', name: 'הנדסת חשמל', courses: ['מעגלים חשמליים', 'עיבוד אותות', 'אלקטרוניקה ספרתית', 'מערכות בקרה'] },
  { group: 'law-faculty', name: 'משפטים', courses: ['דיני חוזים', 'משפט חוקתי', 'דיני נזיקין'] },
];

const TOPICS = [
  'מבוא והגדרות', 'משפטים מרכזיים', 'דוגמאות פתורות', 'הוכחות', 'שיעורי בית', 'חזרה למבחן', 'מקרי קצה', 'סיכום פרק',
  'יישומים', 'שאלות ממבחנים קודמים', 'אלגוריתמים', 'ניתוח סיבוכיות', 'מודלים', 'ניסויים', 'קריאה מודרכת', 'תרגול כיתה',
];

const SENTENCES = [
  'בהרצאה עברנו על ההגדרות הבסיסיות והדגמנו אותן על מספר דוגמאות מהתרגול.',
  'הנקודה החשובה ביותר: יש להבין את <strong>האינטואיציה</strong> לפני שניגשים להוכחה הפורמלית.',
  'המרצה הדגיש שהנושא הזה מופיע כמעט בכל מבחן, בדרך כלל בשאלה הראשונה.',
  'כדאי לחזור על הדוגמה מהשקפים — היא ממחישה בדיוק את המקרה הקצה.',
  'סיבוכיות הזמן היא <em>O(n log n)</em> במקרה הממוצע ו-<em>O(n²)</em> במקרה הגרוע.',
  'בסוף השיעור הוצגה שאלה ממבחן קודם, הפתרון המלא מופיע בקובץ המצורף.',
  'שימו לב להבדל בין ההגדרה בספר לבין ההגדרה שניתנה בכיתה.',
  'The lecturer recommended reading chapter 4 of the textbook before next week.',
  'נשארה שאלה פתוחה לגבי התנאי השני — לשאול בשעות הקבלה.',
  'בתרגול פתרנו שלוש שאלות, השלישית הייתה הקשה ביותר ודרשה אינדוקציה כפולה.',
  'Key idea: reduce the problem to a known one and reuse its bound.',
  'הטבלה בעמוד 12 מסכמת את כל המקרים, כדאי להדפיס אותה.',
  'לא להתבלבל בין התנאי ההכרחי לתנאי המספיק.',
  'הניסוי שהוצג נערך על מדגם של 120 נבדקים, והתוצאות היו מובהקות.',
  'החומר הזה לא ייכלל במבחן לפי הודעת המרצה.',
];

const GENERIC_LABELS = ['מועד א׳', 'מועד ב׳', 'חומר למבחן', 'תרגול', 'הוכחות', 'דוגמאות', 'שקפים', 'חזרה', 'חשוב', 'בונוס', 'קריאת חובה', 'פתרונות', 'טעויות נפוצות', 'הרחבה', 'שאלות פתוחות'];
const COLORS = ['#fe9eae', '#ff0000', '#ffa500', '#008000', '#00b2b2', '#0000c9', '#800080', '#808080'];
const COMMENTS = ['תודה רבה! עזר מאוד 🙏', 'יש טעות קטנה בהגדרה בפסקה השנייה', 'מישהו יודע אם זה בחומר למבחן?', 'סיכום מעולה', 'אפשר להוסיף את הדוגמה מהתרגול?', 'Great summary, thanks!', 'לדעתי בשאלה 2 התשובה שונה', 'מתי ההרצאה הבאה?'];
const LECTURERS = ["פרופ' יוסי אברהם", 'ד"ר רונית שחר', 'ד"ר אמיר גולן', "פרופ' מרים כהן", 'ד"ר עידו נחום', 'ד"ר ליאת ברק', "פרופ' דוד אלון"];
const FIRST = ['יעל', 'אורי', 'נועם', 'תמר', 'עומר', 'מאיה', 'איתן', 'רוני', 'ליה', 'גיא', 'הילה', 'עידו', 'שני', 'אלון', 'נטע'];
const LAST = ['כהן', 'לוי', 'מזרחי', 'פרץ', 'ביטון', 'אברהם', 'פרידמן', 'שפירא', 'דהן', 'אזולאי', 'גבאי', 'חדד'];

/** Extra custom fields; `kind` drives how values are generated. */
const EXTRA_FIELDS = [
  { name: 'סמסטר', type: 'string', kind: 'semester' },
  { name: 'שנת לימודים', type: 'number', kind: 'year' },
  { name: 'מתרגל/ת', type: 'string', kind: 'lecturer' },
  { name: 'מספר תרגיל', type: 'number', kind: 'small' },
  { name: 'מועד הגשה', type: 'date', kind: 'date' },
  { name: 'ציון', type: 'number', kind: 'grade' },
  { name: 'אורך (דקות)', type: 'number', kind: 'minutes' },
  { name: 'מיקום', type: 'string', kind: 'room' },
  { name: 'שעת התחלה', type: 'hour', kind: 'hour' },
  { name: 'מספר עמודים', type: 'number', kind: 'pages' },
  { name: 'מחבר/ת', type: 'string', kind: 'lecturer' },
  { name: 'שם המעבדה', type: 'string', kind: 'lab' },
  { name: 'תאריך המבחן', type: 'date', kind: 'date' },
  { name: 'קישור להקלטה', type: 'string', kind: 'url' },
  { name: 'רמת קושי', type: 'number', kind: 'small' },
  { name: 'מספר משתתפים', type: 'number', kind: 'participants' },
] as const;

const EXTRA_TYPES: { name: string; displayName: string; icon: string; fields: [string, boolean][] }[] = [
  { name: 'exercise', displayName: 'תרגיל', icon: 'generic.svg', fields: [['מספר תרגיל', true], ['מועד הגשה', true], ['מתרגל/ת', false], ['רמת קושי', false]] },
  { name: 'exam', displayName: 'מבחן', icon: 'article.svg', fields: [['תאריך המבחן', true], ['סמסטר', true], ['שנת לימודים', false], ['ציון', false], ['אורך (דקות)', false]] },
  { name: 'lab', displayName: 'מעבדה', icon: 'generic.svg', fields: [['שם המעבדה', true], ['מיקום', false], ['שעת התחלה', false], ['מספר משתתפים', false]] },
  { name: 'seminar', displayName: 'סמינר', icon: 'lecture.svg', fields: [['מחבר/ת', true], ['מספר עמודים', false], ['סמסטר', false]] },
  { name: 'recording', displayName: 'הקלטה', icon: 'video.svg', fields: [['קישור להקלטה', true], ['אורך (דקות)', false], ['שעת התחלה', false]] },
  { name: 'office-hours', displayName: 'שעת קבלה', icon: 'lecture.svg', fields: [['מתרגל/ת', true], ['מיקום', false], ['שעת התחלה', true]] },
];

/** Groups only generated users hold: their summaries exist (and load the queries) but dev users can't see them. */
const EXTRA_PERMISSIONS = [
  { name: 'הפקולטה להנדסת חשמל', groupName: 'ee-faculty', color: '#00b2b2' },
  { name: 'הפקולטה למשפטים', groupName: 'law-faculty', color: '#808080' },
  { name: 'סטודנטים שנה ב׳', groupName: 'year-2', color: '#fe9eae' },
];

const DAY = 86_400_000;
const CHUNK = 500;

async function insertChunked<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) await insert(rows.slice(i, i + CHUNK));
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export async function seedLoad(db: Db, opts: LoadOptions = DEFAULT_LOAD, now = Date.now()): Promise<Record<string, number>> {
  await seed(db, now);

  const r = rng(opts.seed);
  const int = (min: number, max: number) => min + Math.floor(r() * (max - min + 1));
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(r() * arr.length)];
  const some = <T>(arr: readonly T[], max: number) => [...new Set(Array.from({ length: int(0, max) }, () => pick(arr)))];
  /** Skewed pick: low indexes come up far more often (popular authors, busy courses). */
  const skewed = <T>(arr: readonly T[]) => arr[Math.floor(Math.pow(r(), 2.2) * arr.length)];
  /** Generated history never runs past now (a future createdAt would pin rows to the top of the feed). */
  const past = (t: number) => new Date(Math.min(t, now - int(1, 120) * 60_000));
  const counts: Record<string, number> = {};

  await db.transaction(async (tx) => {
    // ---- catalog ---------------------------------------------------------------------------------------
    const basePermissions = await tx.query.permissions.findMany();
    const newPermissions = await tx.insert(s.permissions).values(EXTRA_PERMISSIONS).returning();
    const permByGroup = new Map([...basePermissions, ...newPermissions].map((p) => [p.groupName, p.id]));

    const baseUsers = await tx.query.users.findMany();
    const genUsers = await tx
      .insert(s.users)
      .values(
        Array.from({ length: 30 }, (_, i) => {
          const dept = DEPARTMENTS[i % DEPARTMENTS.length];
          const username = `load${String(i + 1).padStart(2, '0')}`;
          return {
            authIssuer: 'dev',
            authSubject: username,
            username,
            fullName: `${pick(FIRST)} ${pick(LAST)}`,
            department: dept.name,
            email: `${username}@example-university.edu`,
            lastGroupKeys: [dept.group, r() < 0.5 ? 'year-1' : 'year-2'].sort(),
          };
        }),
      )
      .returning();
    // Group membership of every author: dev users' from their last login groups, generated ones as assigned above.
    const authors = [...baseUsers.filter((u) => !u.isSystem), ...genUsers].map((u) => ({ id: u.id, username: u.username, groups: u.lastGroupKeys }));

    const fieldRows = await tx
      .insert(s.fields)
      .values(EXTRA_FIELDS.map((f) => ({ name: f.name, type: f.type })))
      .returning();
    const fieldByName = new Map(fieldRows.map((f, i) => [f.name, { id: f.id, kind: EXTRA_FIELDS[i].kind }]));
    const baseTypeCount = (await tx.query.contentTypes.findMany()).length;
    const newTypes = await tx
      .insert(s.contentTypes)
      .values(EXTRA_TYPES.map((t, i) => ({ name: t.name, displayName: t.displayName, icon: t.icon, position: baseTypeCount + i })))
      .returning();
    await tx.insert(s.contentTypeFields).values(
      EXTRA_TYPES.flatMap((t, i) =>
        t.fields.map(([name, required], position) => ({ contentTypeId: newTypes[i].id, fieldId: fieldByName.get(name)!.id, required, position })),
      ),
    );
    // Every content type with its field list, the base seed's included.
    const types = await tx.query.contentTypes.findMany({ with: { fields: { with: { field: true } } } });

    const courses = DEPARTMENTS.flatMap((d) => d.courses.map((name) => ({ name, dept: d })));
    const existingLabels = new Set((await tx.query.labels.findMany()).map((l) => l.name));
    const labelNames = [...new Set([...GENERIC_LABELS, ...courses.map((c) => c.name), ...courses.flatMap((c) => TOPICS.slice(0, 6).map((t) => `${c.name} - ${t}`))])];
    await insertChunked(
      labelNames.filter((n) => !existingLabels.has(n)).map((name) => ({ name })),
      (rows) => tx.insert(s.labels).values(rows),
    );
    const labelId = new Map((await tx.query.labels.findMany()).map((l) => [l.name, l.id]));

    // ---- summaries -------------------------------------------------------------------------------------
    const valueFor = (kind: string, course: string, eventAt: number): string => {
      switch (kind) {
        case 'semester': return pick(['א׳', 'ב׳', 'קיץ']);
        case 'year': return String(int(2022, 2026));
        case 'lecturer': return pick(LECTURERS);
        case 'small': return String(int(1, 10));
        case 'date': return new Date(eventAt + int(-10, 30) * DAY).toISOString();
        case 'grade': return String(int(55, 100));
        case 'minutes': return String(pick([45, 60, 90, 120, 180]));
        case 'room': return `בניין ${int(1, 12)}, חדר ${int(100, 450)}`;
        case 'hour': return `${String(int(8, 19)).padStart(2, '0')}:${pick(['00', '15', '30', '45'])}`;
        case 'pages': return String(int(5, 60));
        case 'lab': return `מעבדת ${course}`;
        case 'url': return `https://example-university.edu/media/${int(1000, 99999)}`;
        case 'participants': return String(int(4, 40));
        default: return '';
      }
    };
    // The base seed's fields are matched by name.
    const baseFieldValue = (name: string, course: string, eventAt: number): string | null => {
      switch (name) {
        case 'שם הקורס': return course;
        case 'מרצה': return pick(LECTURERS);
        case 'מספר הרצאה': return String(int(1, 13));
        case 'קישור': return `https://example-university.edu/media/${int(1000, 99999)}`;
        case 'משך (דקות)': return String(pick([45, 60, 90]));
        case 'שם הספר': return `${course} — ספר הקורס`;
        case 'פרק': return String(int(1, 14));
        case 'ISBN': return `978-965-${int(100, 999)}-${int(100, 999)}-${int(0, 9)}`;
        case 'כתב עת': return pick(['Nature', 'Science', 'JACM', 'Psychological Review', 'IEEE Transactions']);
        case 'תאריך הגשה': return new Date(eventAt + int(1, 20) * DAY).toISOString();
        case 'שעת קבלה': return `${String(int(9, 17)).padStart(2, '0')}:00`;
        default: return null;
      }
    };
    const fieldValuesFor = (type: (typeof types)[number], course: string, eventAt: number) =>
      type.fields
        // Required fields always; optional ones most of the time.
        .filter((tf) => tf.required || r() < 0.7)
        .map((tf) => {
          const extra = fieldByName.get(tf.field.name);
          const value = extra ? valueFor(extra.kind, course, eventAt) : baseFieldValue(tf.field.name, course, eventAt);
          return value ? { fieldId: tf.fieldId, value } : null;
        })
        .filter((v) => v !== null);
    const contentHtml = (topic: string) => {
      const paragraphs = Array.from({ length: int(2, 9) }, () => `<p>${Array.from({ length: int(1, 4) }, () => pick(SENTENCES)).join(' ')}</p>`);
      const list = r() < 0.35 ? `<ul>${Array.from({ length: int(2, 6) }, () => `<li>${pick(TOPICS)}</li>`).join('')}</ul>` : '';
      return `<h2>${topic}</h2>${paragraphs.join('')}${list}`;
    };

    const summaryRows: (typeof s.summaries.$inferInsert)[] = [];
    const permRows: (typeof s.summaryPermissions.$inferInsert)[] = [];
    const editorRows: (typeof s.summaryEditors.$inferInsert)[] = [];
    const labelRows: (typeof s.summaryLabels.$inferInsert)[] = [];
    const fieldValueRows: (typeof s.summaryFields.$inferInsert)[] = [];
    const commentRows: (typeof s.comments.$inferInsert)[] = [];
    const seenRows: (typeof s.summarySeen.$inferInsert)[] = [];
    const taggedRows: (typeof s.summaryTaggedUsers.$inferInsert)[] = [];
    /** Published regular/running summaries by course, for folders. */
    const byCourse = new Map<string, { id: string; groups: string[] }[]>();

    const addSocial = (id: string, created: number) => {
      const commenters = r() < 0.55 ? some(authors, 5) : [];
      commenters.forEach((c, j) =>
        commentRows.push({ summaryId: id, content: pick(COMMENTS), createdBy: c.id, createdAt: past(created + (j + 1) * int(1, 30) * 3_600_000) }),
      );
      for (const u of some(authors, 12)) seenRows.push({ summaryId: id, userId: u.id });
      if (r() < 0.15) taggedRows.push({ summaryId: id, userId: pick(authors).id });
    };

    const makeSummary = (kind: 'summary' | 'running') => {
      const course = skewed(courses);
      const topic = pick(TOPICS);
      // Mostly the course's faculty; sometimes narrowed further with a year group.
      const groups = [course.dept.group, ...(r() < 0.3 ? [pick(['year-1', 'year-2'])] : [])];
      const eligible = authors.filter((a) => groups.every((g) => a.groups.includes(g)));
      if (!eligible.length) return null;
      const author = skewed(eligible);
      const type = kind === 'running' ? pick(types.filter((t) => ['textbook', 'lecture', 'seminar'].includes(t.name))) : r() < 0.4 ? types.find((t) => t.name === 'lecture')! : pick(types);
      const eventAt = now - int(0, 365) * DAY - int(0, 10) * 3_600_000;
      const created = eventAt + int(0, 48) * 3_600_000;
      const isDraft = kind === 'summary' && r() < 0.04;
      const html = contentHtml(topic);
      const notes = r() < 0.25 ? `<p>${pick(SENTENCES)}</p>` : '';
      const id = randomUUID();
      summaryRows.push({
        id,
        kind,
        title: kind === 'running' ? `${course.name} — סדרה: ${topic}` : `${course.name} — ${topic}`,
        contentHtml: html,
        contentText: htmlToText(html),
        notesHtml: notes,
        notesText: htmlToText(notes),
        department: course.dept.name,
        contentTypeId: type.id,
        isDraft,
        eventDate: kind === 'running' ? null : past(eventAt),
        eventHasTime: kind !== 'running' && r() < 0.7,
        color: r() < 0.2 ? pick(COLORS) : '',
        rangeStart: kind === 'running' ? new Date(eventAt).toISOString().slice(0, 10) : null,
        rangeEnd: kind === 'running' ? new Date(eventAt + int(20, 120) * DAY).toISOString().slice(0, 10) : null,
        createdBy: author.id,
        createdAt: past(created),
        updatedAt: past(created + int(0, 20) * DAY),
      });
      for (const g of groups) permRows.push({ summaryId: id, permissionId: permByGroup.get(g)! });
      editorRows.push({ summaryId: id, userId: author.id });
      if (r() < 0.2) {
        const coEditor = pick(eligible);
        if (coEditor.id !== author.id) editorRows.push({ summaryId: id, userId: coEditor.id });
      }
      const labels = [...new Set([course.name, ...(r() < 0.5 ? [`${course.name} - ${pick(TOPICS.slice(0, 6))}`] : []), ...some(GENERIC_LABELS, 3)])];
      labels.forEach((name, position) => labelRows.push({ summaryId: id, labelId: labelId.get(name)!, position }));
      for (const v of fieldValuesFor(type, course.name, eventAt)) fieldValueRows.push({ summaryId: id, ...v });
      if (!isDraft) {
        addSocial(id, created);
        if (!byCourse.has(course.name)) byCourse.set(course.name, []);
        byCourse.get(course.name)!.push({ id, groups });
      }
      return { id, course, groups, eligible, type, eventAt };
    };

    let sumaroonCount = 0;
    let runningCount = 0;
    for (let i = 0; i < opts.summaries; i++) makeSummary('summary');
    for (let i = 0; i < opts.runningSummaries; i++) {
      const running = makeSummary('running');
      if (!running) continue;
      runningCount++;
      const header = summaryRows[summaryRows.length - 1];
      const start = Date.parse(header.rangeStart!);
      const span = Date.parse(header.rangeEnd!) - start;
      const n = int(3, 25);
      for (let j = 0; j < n; j++) {
        // Sumaroons inherit the series' permissions; a few narrow it with a year group.
        const narrowed = running.eligible.filter((a) => a.groups.includes('year-1'));
        const extra = r() < 0.15 && narrowed.length && !running.groups.includes('year-1') ? ['year-1'] : [];
        const author = pick(extra.length ? narrowed : running.eligible);
        // A series still running today only has entries up to now.
        const eventAt = Math.min(start + Math.floor(((j + r()) / n) * span), now - (n - j) * 3_600_000);
        const html = `<p>${Array.from({ length: int(1, 3) }, () => pick(SENTENCES)).join(' ')}</p>`;
        const id = randomUUID();
        summaryRows.push({
          id,
          kind: 'sumaroon',
          parentId: running.id,
          title: `${j + 1}. ${pick(TOPICS)}`,
          contentHtml: html,
          contentText: htmlToText(html),
          department: running.course.dept.name,
          contentTypeId: running.type.id,
          eventDate: new Date(eventAt),
          eventHasTime: true,
          link: r() < 0.5 ? `https://example-university.edu/books/${int(1, 500)}#p${j + 1}` : null,
          createdBy: author.id,
          createdAt: past(eventAt + 3_600_000),
          updatedAt: past(eventAt + 3_600_000),
        });
        for (const g of extra) permRows.push({ summaryId: id, permissionId: permByGroup.get(g)! });
        editorRows.push({ summaryId: id, userId: author.id });
        for (const v of fieldValuesFor(running.type, running.course.name, eventAt)) fieldValueRows.push({ summaryId: id, ...v });
        addSocial(id, eventAt);
        sumaroonCount++;
      }
    }

    // Running summaries before their sumaroons: the kind trigger checks the parent row exists.
    summaryRows.sort((a, b) => (a.kind === 'sumaroon' ? 1 : 0) - (b.kind === 'sumaroon' ? 1 : 0));
    await insertChunked(summaryRows, (rows) => tx.insert(s.summaries).values(rows));
    await insertChunked(permRows, (rows) => tx.insert(s.summaryPermissions).values(rows));
    await insertChunked(editorRows, (rows) => tx.insert(s.summaryEditors).values(rows).onConflictDoNothing());
    await insertChunked(labelRows, (rows) => tx.insert(s.summaryLabels).values(rows));
    await insertChunked(fieldValueRows, (rows) => tx.insert(s.summaryFields).values(rows));
    await insertChunked(commentRows, (rows) => tx.insert(s.comments).values(rows));
    await insertChunked(seenRows, (rows) => tx.insert(s.summarySeen).values(rows).onConflictDoNothing());
    await insertChunked(taggedRows, (rows) => tx.insert(s.summaryTaggedUsers).values(rows).onConflictDoNothing());

    // ---- folders: faculty → year → semester → course (→ topic) -----------------------------------------
    const folderRows: (typeof s.folders.$inferInsert)[] = [];
    const folderPermRows: (typeof s.folderPermissions.$inferInsert)[] = [];
    const folderEditorRows: (typeof s.folderEditors.$inferInsert)[] = [];
    const folderSummaryRows: (typeof s.folderSummaries.$inferInsert)[] = [];
    const placedSummaries = new Set<string>();
    const folder = (name: string, parentId: string | null, groups: string[], managerPool: typeof authors) => {
      const id = randomUUID();
      const managers = [skewed(managerPool), ...some(managerPool, 1)];
      folderRows.push({ id, name, parentId, createdBy: managers[0].id, createdAt: new Date(now - int(100, 400) * DAY), updatedAt: new Date(now - int(0, 90) * DAY) });
      for (const g of groups) folderPermRows.push({ folderId: id, permissionId: permByGroup.get(g)! });
      for (const m of new Set(managers)) folderEditorRows.push({ folderId: id, userId: m.id });
      return id;
    };
    const placeSummaries = (folderId: string, pool: { id: string }[], max: number) => {
      for (const sm of some(pool, max)) {
        if (placedSummaries.has(sm.id)) continue;
        placedSummaries.add(sm.id);
        folderSummaryRows.push({ folderId, summaryId: sm.id });
      }
    };
    for (const dept of DEPARTMENTS) {
      const managers = authors.filter((a) => a.groups.includes(dept.group));
      if (!managers.length) continue;
      const root = folder(`הפקולטה ל${dept.name}`, null, [dept.group], managers);
      for (const year of ['שנה א׳', 'שנה ב׳']) {
        const yearId = folder(year, root, [dept.group], managers);
        for (const semester of ['סמסטר א׳', 'סמסטר ב׳']) {
          const semId = folder(semester, yearId, [dept.group], managers);
          for (const course of dept.courses.filter(() => r() < 0.5)) {
            const courseId = folder(course, semId, [dept.group], managers);
            const pool = byCourse.get(course) ?? [];
            placeSummaries(courseId, pool, 6);
            // Some courses go one or two levels deeper.
            if (r() < 0.5) {
              const topicId = folder(pick(TOPICS), courseId, [dept.group], managers);
              placeSummaries(topicId, pool, 8);
              if (r() < 0.4) placeSummaries(folder('ארכיון', topicId, [dept.group], managers), pool, 10);
            }
          }
        }
      }
    }
    await insertChunked(folderRows, (rows) => tx.insert(s.folders).values(rows));
    await insertChunked(folderPermRows, (rows) => tx.insert(s.folderPermissions).values(rows));
    await insertChunked(folderEditorRows, (rows) => tx.insert(s.folderEditors).values(rows));
    await insertChunked(folderSummaryRows, (rows) => tx.insert(s.folderSummaries).values(rows));

    // A few favourites and pins for the default dev login so those screens aren't empty.
    const mgolan = authors.find((a) => a.username === 'mgolan')!;
    const visibleToMgolan = [...byCourse.values()].flat().filter((sm) => sm.groups.every((g) => mgolan.groups.includes(g)));
    await tx.insert(s.userFavSummaries).values(some(visibleToMgolan, 15).map((sm) => ({ userId: mgolan.id, summaryId: sm.id }))).onConflictDoNothing();

    Object.assign(counts, {
      users: genUsers.length,
      fields: fieldRows.length,
      contentTypes: newTypes.length,
      summaries: summaryRows.length - runningCount - sumaroonCount,
      runningSummaries: runningCount,
      sumaroons: sumaroonCount,
      fieldValues: fieldValueRows.length,
      labels: labelId.size,
      comments: commentRows.length,
      folders: folderRows.length,
      folderSummaries: folderSummaryRows.length,
    });
  });
  return counts;
}
