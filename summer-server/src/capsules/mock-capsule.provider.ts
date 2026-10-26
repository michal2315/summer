import { Capsule, CapsuleProvider, CapsuleWord, normalizeCapsuleName } from './capsule';

const must = (...words: string[]): CapsuleWord[] => words.map((word) => ({ word, condition: 'must' }));
const not = (...words: string[]): CapsuleWord[] => words.map((word) => ({ word, condition: 'mustNot' }));
const opt = (...words: string[]): CapsuleWord[] => words.map((word) => ({ word, condition: 'optional' }));

/** Demo capsules, written against the seed data (courses, topics and paragraphs in database/seed). */
export const MOCK_CAPSULES: Capsule[] = [
  {
    id: 'cap-exams',
    name: 'מבחנים',
    description: 'כל מה שנוגע למבחנים ולמועדים',
    words: opt('מבחן', 'בחינה', 'מועד א׳', 'מועד ב׳', 'חומר למבחן', 'שאלה ממבחן', 'פתרונות'),
  },
  {
    id: 'cap-exam-important',
    name: 'חשוב למבחן',
    description: 'חייב להזכיר מבחן, ולפחות סימן אחד שזה חשוב',
    words: [...must('מבחן'), ...opt('חשוב', 'הדגיש', 'כמעט בכל', 'שאלה הראשונה')],
  },
  {
    id: 'cap-complexity',
    name: 'סיבוכיות',
    description: 'זמני ריצה וניתוח סיבוכיות',
    words: opt('סיבוכיות', 'O(n', 'log n', 'זמן ריצה', 'מקרה הגרוע', 'מקרה הממוצע', 'NP'),
  },
  {
    id: 'cap-trees',
    name: 'עצים',
    description: 'עצי חיפוש למיניהם',
    words: opt('עצי', 'עץ', 'AVL', 'עצי B', 'סיבובים', 'ערימות'),
  },
  {
    id: 'cap-ds-no-trees',
    name: 'מבני נתונים בלי עצים',
    description: 'מבני נתונים, בלי כל מה שקשור לעצים',
    words: [...must('מבני נתונים'), ...not('עצי', 'AVL', 'עץ')],
  },
  {
    id: 'cap-graphs',
    name: 'גרפים',
    description: 'אלגוריתמים על גרפים',
    words: opt('גרף', 'גרפים', 'מסלולים קצרים', 'זרימה ברשתות', 'BFS', 'DFS', 'דייקסטרה'),
  },
  {
    id: 'cap-calculus',
    name: 'חשבון אינפיניטסימלי',
    description: 'נושאי חדו"א',
    words: opt('גבולות', 'רציפות', 'נגזרות', 'אינטגרלים', 'טורי טיילור', 'סדרות', 'לגרנז׳'),
  },
  {
    id: 'cap-linear',
    name: 'אלגברה לינארית',
    description: 'מרחבים, העתקות ומטריצות',
    words: opt('מרחבים וקטוריים', 'העתקות לינאריות', 'דטרמיננטות', 'ערכים עצמיים', 'לכסון', 'מכפלה פנימית', 'מטריצה'),
  },
  {
    id: 'cap-cognitive',
    name: 'פסיכולוגיה קוגניטיבית',
    description: 'זיכרון, תפיסה ולמידה — לא זיכרון של מחשב',
    words: [...opt('זיכרון', 'תפיסה', 'למידה והתניה', 'מוטיבציה'), ...not('זיכרון וירטואלי', 'מערכות הפעלה')],
  },
  {
    id: 'cap-concurrency',
    name: 'מקביליות',
    description: 'סנכרון ותהליכים במערכות הפעלה',
    words: opt('סנכרון', 'קיפאון', 'תהליכונים', 'תהליכים', 'מנעול', 'סמפור', 'תזמון'),
  },
  {
    id: 'cap-proofs',
    name: 'הוכחות',
    description: 'הגדרות, משפטים והוכחות',
    words: opt('הוכחה', 'ההוכחה', 'משפט', 'הגדרה', 'ההגדרות', 'למה'),
  },
  {
    id: 'cap-practice',
    name: 'תרגול ודוגמאות',
    description: 'תרגולים, דוגמאות ושקפים',
    words: opt('תרגול', 'מהתרגול', 'דוגמה', 'דוגמאות', 'שקפים', 'מהשקפים'),
  },
  {
    id: 'cap-review',
    name: 'לחזור על החומר',
    description: 'דברים שכתוב לחזור עליהם או לבדוק שוב',
    words: opt('לחזור', 'לבדוק שוב', 'כדאי לחזור', 'חזרה'),
  },
  {
    id: 'cap-cs-core',
    name: 'ליבה במדעי המחשב',
    description: 'קורסי החובה במדעי המחשב, בלי מתמטיקה',
    words: [...opt('מבוא לאלגוריתמים', 'מבני נתונים', 'מערכות הפעלה'), ...not('חדו"א', 'אלגברה לינארית')],
  },
];

/**
 * Stand-in for the external capsule API: in-memory, with network-like latency so the client's loading states show.
 * Swap for a real HTTP client implementing CapsuleProvider when the service is available.
 */
export class MockCapsuleProvider extends CapsuleProvider {
  constructor(
    private readonly latencyMs = 120,
    private readonly capsules = MOCK_CAPSULES,
  ) {
    super();
  }

  async search(q: string, limit: number): Promise<Capsule[]> {
    await this.delay();
    const s = normalizeCapsuleName(q);
    if (!s) return this.capsules.slice(0, limit);
    const prefix: Capsule[] = [];
    const contains: Capsule[] = [];
    for (const c of this.capsules) {
      const n = normalizeCapsuleName(c.name);
      if (n.startsWith(s) || n.split(' ').some((p) => p.startsWith(s))) prefix.push(c);
      else if (n.includes(s)) contains.push(c);
    }
    return [...prefix, ...contains].slice(0, limit);
  }

  async byIds(ids: string[]): Promise<Capsule[]> {
    await this.delay();
    return this.capsules.filter((c) => ids.includes(c.id));
  }

  async byNames(names: string[]): Promise<Capsule[]> {
    await this.delay();
    const wanted = new Set(names.map(normalizeCapsuleName));
    return this.capsules.filter((c) => wanted.has(normalizeCapsuleName(c.name)));
  }

  private delay(): Promise<void> {
    return this.latencyMs ? new Promise((r) => setTimeout(r, this.latencyMs * (0.6 + Math.random() * 0.8))) : Promise.resolve();
  }
}
