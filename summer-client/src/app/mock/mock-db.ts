/* Dev-only seed data for the mock backend. Shapes match the server documents (ids, not populated refs). */
import { FieldsType, IContentType, IField, IMention, INotification, INotificationSettings, IPermission, ISummarySearch, NotificationsFunctionsOptions } from '../shared/models';

export interface DbUser {
  _id: string;
  username: string;
  fullName: string;
  department: string;
  email: string;
  isSystem?: boolean;
  pinnedSearches: ISummarySearch[];
  pinnedLabels: string[];
  favoriteLabels: string[];
  pinnedPermissions: string[];
  pinnedCollections: string[];
  favoriteCollections: string[];
  following: string[];
  recentExtraField: string[];
  favoriteSummaries: string[];
  /** permission-group ids the user belongs to */
  permissions: string[];
  /** what's-new versions the user acknowledged */
  acknowledged: string[];
}

export interface DbComment {
  _id: string;
  content: string;
  mentions: IMention[];
  user: string;
  creationDate: string;
}

export interface DbSummary {
  _id: string;
  title: string;
  content: string;
  notes: string;
  department: string;
  user: string;
  isDraft: boolean;
  creationDate: string;
  modifyDate: string;
  eventDate?: string;
  eventSecTime?: string;
  contentType: string;
  labels: string[];
  comments: DbComment[];
  summaryFields: { field: string; value: string }[];
  files: string[];
  taggedUsers: string[];
  collectionIds: string[];
  permissions: string[];
  seenBy: string[];
  color: string;
  timelineTitle?: string;
  /** hierarchy folder holding this summary, if any */
  folderId?: string;
}

export interface DbCollection {
  _id: string;
  name: string;
  permissions: string[];
  managers: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** hierarchy folder holding this collection, if any */
  folderId?: string;
}

export interface DbFolder {
  _id: string;
  name: string;
  parentId: string | null;
  permissions: string[];
  managers: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface DbNotification extends Omit<INotification, 'createdBy'> {
  userId: string;
  createdBy?: string;
}

export interface MockDb {
  version: number;
  users: DbUser[];
  permissions: IPermission[];
  fields: IField[];
  contentTypes: IContentType[];
  collections: DbCollection[];
  folders: DbFolder[];
  labels: string[];
  summaries: DbSummary[];
  notifications: DbNotification[];
  notificationSettings: INotificationSettings[];
  seq: number;
}

/** Bump to reseed browsers that already have an older mock DB in localStorage. */
export const DB_VERSION = 4;

// Deterministic PRNG so every fresh seed looks the same.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const user = (id: string, username: string, fullName: string, department: string, extra: Partial<DbUser> = {}): DbUser => ({
  _id: id,
  username,
  fullName,
  department,
  email: `${username}@example-university.edu`,
  pinnedSearches: [],
  pinnedLabels: [],
  favoriteLabels: [],
  pinnedPermissions: [],
  pinnedCollections: [],
  favoriteCollections: [],
  following: [],
  recentExtraField: [],
  favoriteSummaries: [],
  permissions: ['p1', 'p4'],
  acknowledged: [],
  ...extra,
});

const COURSES = [
  { name: 'מבוא לאלגוריתמים', dept: 'מדעי המחשב', topics: ['תכנון דינמי', 'אלגוריתמים חמדניים', 'גרפים ומסלולים קצרים', 'מיון וחיפוש', 'זרימה ברשתות', 'NP-שלמות'] },
  { name: 'מבני נתונים', dept: 'מדעי המחשב', topics: ['עצי AVL', 'טבלאות גיבוב', 'ערימות', 'עצי B', 'Union-Find', 'רשימות דילוג'] },
  { name: 'חדו"א 1', dept: 'מתמטיקה', topics: ['גבולות ורציפות', 'נגזרות', 'משפט לגרנז׳', 'אינטגרלים', 'טורי טיילור', 'סדרות'] },
  { name: 'אלגברה לינארית', dept: 'מתמטיקה', topics: ['מרחבים וקטוריים', 'העתקות לינאריות', 'דטרמיננטות', 'ערכים עצמיים', 'לכסון', 'מכפלה פנימית'] },
  { name: 'מבוא לפסיכולוגיה', dept: 'מדעי ההתנהגות', topics: ['זיכרון', 'למידה והתניה', 'תפיסה', 'מוטיבציה', 'התפתחות', 'אישיות'] },
  { name: 'מערכות הפעלה', dept: 'מדעי המחשב', topics: ['תהליכים ותהליכונים', 'תזמון', 'סנכרון', 'זיכרון וירטואלי', 'מערכות קבצים', 'קיפאון'] },
];

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

export function seedDb(): MockDb {
  const r = rng(42);
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(r() * arr.length)];
  const some = <T>(arr: readonly T[], max: number) => [...new Set(Array.from({ length: Math.floor(r() * (max + 1)) }, () => pick(arr)))];

  const users: DbUser[] = [
    user('u0', 'summer', 'Summer', 'מערכת', { isSystem: true }),
    user('u1', 'mgolan', 'מיכל גולן', 'מדעי המחשב', { permissions: ['p1', 'p4', 'p5'], following: ['u2'], pinnedLabels: ['חומר למבחן'], favoriteLabels: ['חשוב'] }),
    user('u2', 'dlevi', 'דנה לוי', 'מדעי המחשב'),
    user('u3', 'yavraham', "פרופ' יוסי אברהם", 'מתמטיקה'),
    user('u4', 'nmizrahi', 'נועה מזרחי', 'מדעי ההתנהגות'),
    user('u5', 'aperetz', 'אורי פרץ', 'מדעי המחשב'),
    user('u6', 'sbiton', 'שירה ביטון', 'מתמטיקה'),
    user('u7', 'efriedman', 'איתי פרידמן', 'מדעי המחשב'),
  ];

  const permissions: IPermission[] = [
    { _id: 'p1', name: 'הפקולטה למדעי המחשב', groupName: 'cs-faculty', color: '#0000c9' },
    { _id: 'p2', name: 'הפקולטה למתמטיקה', groupName: 'math-faculty', color: '#008000' },
    { _id: 'p3', name: 'מדעי ההתנהגות', groupName: 'behavioral', color: '#800080' },
    { _id: 'p4', name: 'סטודנטים שנה א׳', groupName: 'year-1', color: '#ffa500' },
    { _id: 'p5', name: 'סגל אקדמי', groupName: 'staff', color: '#ff0000' },
  ];

  const fields: IField[] = [
    { _id: 'f1', name: 'שם הקורס', type: FieldsType.String },
    { _id: 'f2', name: 'מרצה', type: FieldsType.String },
    { _id: 'f3', name: 'מספר הרצאה', type: FieldsType.Number },
    { _id: 'f4', name: 'קישור', type: FieldsType.String },
    { _id: 'f5', name: 'משך (דקות)', type: FieldsType.Number },
    { _id: 'f6', name: 'שם הספר', type: FieldsType.String },
    { _id: 'f7', name: 'פרק', type: FieldsType.Number },
    { _id: 'f8', name: 'ISBN', type: FieldsType.String },
    { _id: 'f9', name: 'כתב עת', type: FieldsType.String },
    { _id: 'f10', name: 'תאריך הגשה', type: FieldsType.Date },
    { _id: 'f11', name: 'שעת קבלה', type: FieldsType.Hour },
    { _id: 'f12', name: 'תגיות', type: FieldsType.Array },
  ];

  const contentTypes: IContentType[] = [
    { _id: 'ct1', name: 'lecture', displayName: 'שיעור', icon: 'lecture.svg', fields: [{ field: 'f1', required: true }, { field: 'f2', required: false }, { field: 'f3', required: false }] },
    { _id: 'ct2', name: 'video', displayName: 'וידאו', icon: 'video.svg', fields: [{ field: 'f4', required: true }, { field: 'f5', required: false }] },
    { _id: 'ct3', name: 'textbook', displayName: 'ספר', icon: 'book.svg', fields: [{ field: 'f6', required: true }, { field: 'f7', required: false }, { field: 'f8', required: false }] },
    { _id: 'ct4', name: 'article', displayName: 'מאמר', icon: 'article.svg', fields: [{ field: 'f4', required: true }, { field: 'f9', required: false }] },
    { _id: 'ct5', name: 'generic', displayName: 'כללי', icon: 'generic.svg', fields: [] },
  ];

  const now = Date.now();
  const iso = (t: number) => new Date(t).toISOString();
  const DAY = 86_400_000;

  const collections: DbCollection[] = COURSES.slice(0, 5).map((c, i) => ({
    _id: `c${i + 1}`,
    name: `סמ׳ א׳ - ${c.name}`,
    permissions: [],
    managers: ['u1'],
    createdBy: 'u1',
    createdAt: iso(now - 120 * DAY),
    updatedAt: iso(now - 10 * DAY),
  }));

  const summaries: DbSummary[] = [];
  const authors = users.filter((u) => !u.isSystem);
  for (let i = 0; i < 48; i++) {
    const courseIdx = Math.floor(r() * COURSES.length);
    const course = COURSES[courseIdx];
    const topic = pick(course.topics);
    const author = i < 4 ? users[1] : pick(authors);
    const type = r() < 0.6 ? contentTypes[0] : pick(contentTypes.slice(1));
    const eventAt = now - Math.floor(r() * 90) * DAY - Math.floor(r() * 8) * 3_600_000;
    const created = eventAt + Math.floor(r() * 3) * 3_600_000;
    const paragraphs = some(PARAGRAPHS, 4);
    const typeFields =
      type.name === 'lecture'
        ? [{ field: 'f1', value: course.name }, { field: 'f2', value: pick(["פרופ' יוסי אברהם", 'ד"ר רונית שחר', 'ד"ר אמיר גולן']) }, { field: 'f3', value: String(1 + Math.floor(r() * 12)) }]
        : type.name === 'video' || type.name === 'article'
          ? [{ field: 'f4', value: `https://example-university.edu/media/${1000 + i}` }]
          : type.name === 'textbook'
            ? [{ field: 'f6', value: `${course.name} — ספר הקורס` }, { field: 'f7', value: String(1 + Math.floor(r() * 10)) }]
            : [];
    const commenters = some(authors, 3);
    summaries.push({
      _id: `s${i + 1}`,
      title: `${course.name} — ${topic}`,
      content: `<h2>${topic}</h2>` + paragraphs.map((p) => `<p>${p}</p>`).join('') + (r() < 0.4 ? `<ul><li>הגדרה</li><li>משפט</li><li>דוגמה</li></ul>` : '') + ` <p>#${pick(LABELS).replace(/\s/g, '_')}</p>`,
      notes: r() < 0.3 ? '<p>לבדוק שוב את ההוכחה בעמוד 3.</p>' : '',
      department: course.dept,
      user: author._id,
      isDraft: author._id === 'u1' && i % 4 === 3,
      creationDate: iso(created),
      modifyDate: iso(created + Math.floor(r() * 5) * DAY),
      eventDate: iso(eventAt),
      eventSecTime: iso(eventAt),
      contentType: type._id,
      labels: [...new Set([course.name, ...some(LABELS, 3)])],
      comments: commenters.map((c, j) => ({
        _id: `cm${i}_${j}`,
        content: pick(['תודה רבה! עזר מאוד 🙏', 'יש טעות קטנה בהגדרה בפסקה השנייה', 'מישהו יודע אם זה בחומר למבחן?', 'סיכום מעולה', '@dlevi תסתכלי על זה']),
        mentions: [],
        user: c._id,
        creationDate: iso(created + (j + 1) * 3_600_000),
      })),
      summaryFields: typeFields,
      files: r() < 0.3 ? [`${topic.replace(/\s/g, '-')}-slides.pdf`] : [],
      taggedUsers: r() < 0.25 ? [pick(authors)._id] : [],
      collectionIds: courseIdx < 5 && r() < 0.6 ? [`c${courseIdx + 1}`] : [],
      permissions: [course.dept === 'מתמטיקה' ? 'p2' : course.dept === 'מדעי המחשב' ? 'p1' : 'p3', ...(r() < 0.4 ? ['p4'] : [])],
      seenBy: some(authors, 4).map((u) => u._id),
      color: r() < 0.35 ? pick(['#fe9eae', '#ff0000', '#ffa500', '#008000', '#00b2b2', '#0000c9', '#800080', '#808080']) : '',
    });
  }
  users[1].favoriteSummaries = ['s5', 's9', 's14'];

  const folder = (id: string, name: string, parentId: string | null, extra: Partial<DbFolder> = {}): DbFolder => ({
    _id: id,
    name,
    parentId,
    permissions: [],
    managers: ['u1'],
    createdBy: 'u1',
    createdAt: iso(now - 60 * DAY),
    updatedAt: iso(now - 5 * DAY),
    ...extra,
  });
  const folders: DbFolder[] = [
    folder('fd1', 'שנה א׳', null),
    folder('fd2', 'סמסטר א׳', 'fd1'),
    folder('fd3', 'סמסטר ב׳', 'fd1'),
    folder('fd4', 'מדעי המחשב', 'fd2', { permissions: ['p1'] }),
    folder('fd5', 'מתמטיקה', 'fd2', { permissions: ['p2'], managers: ['u1', 'u3'] }),
    folder('fd6', 'מדעי ההתנהגות', 'fd2'),
    // Visible to the mock user (staff) but managed by someone else — read-only for them.
    folder('fd7', 'חומרי הוראה לסגל', null, { permissions: ['p5'], managers: ['u3'], createdBy: 'u3' }),
  ];
  const place = (folderId: string, ...ids: string[]) => {
    for (const c of collections) if (ids.includes(c._id)) c.folderId = folderId;
    for (const s of summaries) if (ids.includes(s._id) && !s.isDraft) s.folderId = folderId;
  };
  place('fd4', 'c1', 'c2', 's1', 's2');
  place('fd5', 'c3', 'c4');
  place('fd6', 'c5');
  place('fd1', 's3');
  place('fd7', 's5', 's6');

  const notifications: DbNotification[] = [
    { _id: 'n1', userId: 'u1', text: 'דנה לוי תייגה אותך בסיכום "מבני נתונים — עצי AVL"', summaryId: 's7', creationDate: iso(now - 2 * 3_600_000), isViewed: false, createdBy: 'u2' },
    { _id: 'n2', userId: 'u1', text: 'תגובה חדשה על הסיכום שלך', summaryId: 's1', creationDate: iso(now - 26 * 3_600_000), isViewed: false, createdBy: 'u5' },
    { _id: 'n3', userId: 'u1', text: 'סיכום חדש נוסף לאוסף "סמ׳ א׳ - מבוא לאלגוריתמים"', summaryId: 's12', creationDate: iso(now - 4 * DAY), isViewed: true },
  ];

  const notificationSettings: INotificationSettings[] = [
    {
      _id: 'ns1',
      name: 'הרצאות חדשות במבני נתונים',
      conditions: [{ field: fields[0], funcName: NotificationsFunctionsOptions.StringContains, content: ['מבני נתונים'] }],
      isMail: false,
      isNotify: true,
      creationDate: iso(now - 30 * DAY),
    },
  ];

  return {
    version: DB_VERSION,
    users,
    permissions,
    fields,
    contentTypes,
    collections,
    folders,
    labels: [...new Set([...LABELS, ...COURSES.map((c) => c.name)])],
    summaries,
    notifications,
    notificationSettings,
    seq: 1000,
  };
}
