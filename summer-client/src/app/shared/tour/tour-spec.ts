import { AppFeatures } from '../../core/config/app-config';
import { ALT_KEYS, AltKeyId } from '../keyboard/alt-keys';
import { MARK } from '../utils/search-syntax';

/** What a step's prep / do / when / action may use to drive the app. Implemented by TourService. */
export interface TourContext {
  /**
   * Navigate to a path, then wait for the page to render. No-op when already there: by path only (query params
   * ignored), or with `exact` only when the URL is exactly `path` (e.g. "all summaries" rather than a folder).
   */
  go(path: string, exact?: boolean): Promise<void>;
  /** The current router URL, query included. */
  url(): string;
  userId(): string | null;
  feature(name: keyof AppFeatures): boolean;
  showShortcuts(): void;
}

/**
 * One tour step.
 * - `sel`: CSS selector(s) of the element to spotlight — the first visible, clickable match wins. Omit for a centered card.
 * - `kbd`: shortcuts as 'Alt+G' or 'Alt+G label'.
 * - `do`: the user performs it (the page stays usable); the tour moves on by itself once `until()` is true.
 * - `when`: checked after `prep`; false skips the step (e.g. nothing to sort, a feature that is off).
 * - `arrive`: said at the top of the step when the page changed since the last step ("אתם עכשיו ב…"), so a new
 *   page never just appears. Write it so it fits both a page the user opened and one the tour opened.
 * - `action`: a button that ends the tour and runs something.
 * - `added`: ISO date — the step is marked "חדש" (hub, nudge, dot on the tour button) for NEW_DAYS.
 */
export interface TourStep {
  id: string;
  title: string;
  body: string;
  sel?: string | string[];
  tip?: string;
  kbd?: string[];
  prep?: (ctx: TourContext) => Promise<void>;
  when?: (ctx: TourContext) => boolean;
  do?: { hint: string; until: (ctx: TourContext) => boolean };
  arrive?: string;
  action?: { label: string; run: (ctx: TourContext) => void };
  added?: string;
}

export interface TourTopic {
  id: string;
  title: string;
  desc: string;
  /** A chapter of the full tour: offered first and shown automatically on a first visit. */
  core?: boolean;
  steps: TourStep[];
}

/** How long a step with `added` counts as new. */
export const NEW_DAYS = 30;

/** The full tour (WELCOME_STEP, every core topic, FINISH_STEP) as the hub offers it. */
export const FULL_TOUR = { title: 'הסיור המלא', desc: 'תיקיות, מיון הלקטים, חיפוש, תמציות רצף ו-Pouch · כ-3 דקות' };

const alt = (id: AltKeyId) => `Alt+${ALT_KEYS[id].key}`;
/** The element bound to an Alt shortcut (AltKeyDirective sets aria-keyshortcuts). */
const altSel = (id: AltKeyId) => `[aria-keyshortcuts="${alt(id)}"]`;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);
/** Waits (up to `ms`) for an element to exist. */
async function waitFor(sel: string, ms = 2000): Promise<HTMLElement | null> {
  const until = Date.now() + ms;
  let el = $(sel);
  while (!el && Date.now() < until) {
    await wait(50);
    el = $(sel);
  }
  return el;
}
/** Scrolls an element into view (the spotlight only finds what is on screen). */
async function reveal(sel: string) {
  const el = await waitFor(sel);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  await wait(60);
}
/** Clicks an element when it's there, then gives the app a moment to react. */
async function click(sel: string, ms = 250) {
  const el = $(sel);
  if (!el) return;
  el.click();
  await wait(ms);
}
async function waitUntil(test: () => boolean, ms = 2000) {
  const until = Date.now() + ms;
  while (!test() && Date.now() < until) await wait(50);
}

const path = (ctx: TourContext) => ctx.url().split(/[?#]/)[0];
const summaryOpen = (ctx: TourContext) => /[?&]summaryId=/.test(ctx.url());
const folderOpen = (ctx: TourContext) => /[?&]folderId=/.test(ctx.url());
const runningOpen = (ctx: TourContext) => /[?&]runningId=/.test(ctx.url()) || path(ctx).startsWith('/running/');

const FOLDER_LINK = 'app-folder-tree .node:not(.root):not(.unfiled) .link';
const SEARCH_BOX = 'app-summary-search .box';
const SEARCH_INPUT = 'app-summary-search input.input';
const ADVANCED = 'app-advanced-search';
const RUNNING_CARD = '.card:has(> .running-banner)';
const POUCH_TAB = 'app-profile-shelf .tab:has([nztype="file-text"])';
const hasToSort = () => !!$('.to-sort');

export const WELCOME_STEP: TourStep = {
  id: '_welcome',
  title: 'ברוכים הבאים ל-Summer החדש',
  body: 'בכמה דקות נעבור על מה שחדש: תיקיות, מיון הלקטים הישנים, חיפוש, תמציות רצף ו-Pouch. ברוב הצעדים תלחצו בעצמכם, והסיור ימשיך לבד.',
  tip: 'Esc יוצא מהסיור. אפשר לחזור אליו מ"סיור ועזרה" בתחתית התפריט.',
};

export const FINISH_STEP: TourStep = {
  id: '_finish',
  sel: '.tour-btn',
  title: 'זהו, אפשר להתחיל',
  body: 'כל חלק בסיור אפשר לראות שוב מכאן, וגם נושאים נוספים: התראות, בחירה וייצוא, מקלדת.',
  tip: 'משהו לא עובד או לא ברור? "פנייה לצוות סאני" בתחתית התפריט.',
  arrive: 'אתם עכשיו ב"כל התמציות"',
  kbd: [alt('tour')],
  prep: (ctx) => ctx.go('/summaries', true),
};

/**
 * The guided tour, the hub's topics and the what's-new nudge all come from here.
 * RULE: every new feature adds a step (in the right topic) with `added: 'YYYY-MM-DD'`.
 * `id`s are remembered per user as seen — keep them stable.
 * Prefer `do` steps (the user clicks the real thing) over the tour navigating; when the page changes, set `arrive`.
 */
export const TOUR_TOPICS: TourTopic[] = [
  // ---- the full tour, in order
  {
    id: 'hierarchy',
    core: true,
    title: 'תיקיות',
    desc: 'עץ התיקיות שבתפריט',
    steps: [
      {
        id: 'h-tree',
        sel: 'app-folder-tree .body',
        title: 'תיקיות במקום לקטים',
        body: 'כל התמציות מסודרות עכשיו בעץ תיקיות. בתיקייה יכולות להיות תיקיות משנה, ותמצית יכולה להיות בכמה תיקיות.',
        added: '2026-11-23',
        prep: (ctx) => ctx.go('/summaries', true),
        do: { hint: 'לחצו על תיקייה כלשהי בעץ', until: folderOpen },
      },
      {
        id: 'h-folder',
        sel: '.title-group',
        title: 'התיקייה נפתחה',
        body: 'כאן התמציות שבתיקייה וגם בכל תיקיות המשנה שלה. "כל התמציות" בראש העץ מחזיר להכול.',
        tip: 'קליק ימני על תיקייה: תיקיית משנה, עריכה והרשאות, העברה.',
        arrive: 'אתם עכשיו בתוך התיקייה',
        added: '2026-11-23',
        prep: async (ctx) => {
          if (folderOpen(ctx)) return;
          await click(FOLDER_LINK);
          await waitUntil(() => folderOpen(ctx));
        },
      },
    ],
  },
  {
    id: 'staging',
    core: true,
    title: 'המעבר מ-Summer הישן',
    desc: 'מיון הלקטים הישנים לתיקיות',
    steps: [
      {
        id: 'st-link',
        sel: '.to-sort',
        title: 'הלקטים הישנים שלכם',
        body: 'הלקטים מ-Summer הישן מחכים למיון לתיקיות החדשות. יש להם דף משלו שעושה את זה מהר.',
        added: '2026-11-23',
        when: hasToSort,
        do: { hint: 'לחצו על הקישור כדי לעבור לדף המיון', until: (ctx) => path(ctx) === '/staging' },
      },
      {
        id: 'st-page',
        sel: ['app-staging-page .columns', 'app-staging-page .page'],
        title: 'דף המיון',
        body: 'מימין הלקטים הישנים, משמאל התיקיות החדשות. מסמנים תמציות ולוחצים על תיקייה, או גוררים אותן אליה.',
        tip: 'לקט שכבר מסודר טוב? "להשאיר כמו שהוא" הופך אותו לתיקייה בלי לפרק אותו.',
        arrive: 'אתם עכשיו בדף המיון',
        added: '2026-11-23',
        prep: async (ctx) => {
          if (hasToSort()) await ctx.go('/staging');
        },
        when: (ctx) => path(ctx) === '/staging',
      },
    ],
  },
  {
    id: 'search',
    core: true,
    title: 'חיפוש',
    desc: 'סימנים, חיפוש מתקדם וחיפושים שמורים',
    steps: [
      {
        id: 's-ops',
        sel: SEARCH_BOX,
        title: 'חיפוש עם סימנים',
        body: 'מילה רגילה נמצאת בכל מקום בתמצית. סימנים מדייקים: @ לכותב/ת, :שדה: לשדה אחד, # לכמוסה, ו"וגם / או / לא" בין מילים.',
        tip: 'כל הסימנים, כולל ביטויים רגולריים: עמדו עם העכבר על / בקצה התיבה.',
        arrive: 'אתם עכשיו ב"כל התמציות"',
        kbd: [alt('search'), '/ מכל מקום'],
        added: '2026-11-23',
        prep: (ctx) => ctx.go('/summaries', true),
        do: { hint: 'נסו: הקלידו @ בתיבה', until: () => !!$<HTMLInputElement>(SEARCH_INPUT)?.value.includes(MARK) },
      },
      {
        id: 's-advanced',
        sel: altSel('advancedSearch'),
        title: 'חיפוש מתקדם',
        body: 'כשצריך כמה תנאים יחד: על שדות, על תאריכים, עם וגם / או.',
        kbd: [alt('advancedSearch')],
        added: '2026-11-23',
        prep: (ctx) => ctx.go('/summaries'),
        do: { hint: 'לחצו על הכפתור כדי לפתוח אותו', until: () => !!$(ADVANCED) },
      },
      {
        id: 's-advanced-panel',
        sel: `${ADVANCED} .panel`,
        title: 'בונים שאילתה',
        body: 'מוסיפים תנאים וקבוצות, והמשפט למעלה מתאר במילים מה יחופש. "חיפוש" מריץ, ואפשר גם לשמור בשם.',
        tip: 'אפשר להתחיל מחיפוש שמור ולשנות אותו.',
        added: '2026-11-23',
        prep: async (ctx) => {
          await ctx.go('/summaries');
          if (!$(ADVANCED)) await click(altSel('advancedSearch'));
        },
      },
      {
        id: 's-saved',
        sel: SEARCH_BOX,
        title: 'חיפושים שמורים',
        body: 'חיפוש שתרצו לחזור אליו? אחרי שמריצים אותו, כפתור השמירה בתיבה שומר אותו בשם. לחיצה על תיבה ריקה מציגה את כל השמורים.',
        tip: 'על חיפוש שמור אפשר לקבל התראה כשנכתבת תמצית חדשה שמתאימה לו (הפעמון שבתיבה).',
        kbd: [`${alt('pinSearch')} שמירה`, `${alt('alertSearch')} התראה`],
        added: '2026-11-23',
        prep: async (ctx) => {
          await ctx.go('/summaries');
          // Close the advanced panel and clear what was typed in the previous steps.
          await click('app-summary-search .overlay', 120);
          await click(altSel('clearSearch'), 120);
        },
      },
    ],
  },
  {
    id: 'running',
    core: true,
    title: 'תמציות רצף',
    desc: 'נושא מתמשך שמתעדכן בתמציתוניות',
    steps: [
      {
        id: 'r-card',
        sel: RUNNING_CARD,
        title: 'תמצית רצף',
        body: 'תמצית שמלווה נושא לאורך זמן: כל עדכון הוא "תמציתונית" קצרה, והרצף מרכז את כולן. מזהים אותה לפי הפס שבראש הכרטיס.',
        arrive: 'אתם עכשיו ב"כל התמציות"',
        added: '2026-11-23',
        prep: async (ctx) => {
          await ctx.go('/summaries', true);
          await waitFor('app-summary-card');
          await reveal(RUNNING_CARD);
        },
        when: () => !!$(RUNNING_CARD),
        do: { hint: 'לחצו על הכרטיס כדי לפתוח את הרצף', until: runningOpen },
      },
      {
        id: 'r-page',
        sel: 'app-running-page .running',
        title: 'בתוך הרצף',
        body: 'מימין פרטי הנושא, ולידם כל התמציתוניות על ציר זמן. "+ תמציתונית" מוסיף עדכון חדש.',
        tip: 'רצף חדש: "תמצית חדשה" ← "תמצית רצף".',
        arrive: 'אתם עכשיו בתמצית הרצף',
        added: '2026-11-23',
        prep: async (ctx) => {
          if (runningOpen(ctx)) return;
          await click(RUNNING_CARD);
          await waitUntil(() => runningOpen(ctx));
        },
        when: runningOpen,
      },
      {
        id: 'r-what',
        title: 'תמצית רצף',
        body: 'תמצית שמלווה נושא לאורך זמן: כל עדכון הוא "תמציתונית" קצרה, והרצף מציג את כולן על ציר זמן. מזהים אותה ברשימה לפי הפס "תמצית רצף" שבראש הכרטיס.',
        tip: 'רצף חדש: "תמצית חדשה" ← "תמצית רצף".',
        when: (ctx) => !runningOpen(ctx) && !$(RUNNING_CARD),
      },
    ],
  },
  {
    id: 'pouch',
    core: true,
    title: 'Pouch',
    desc: 'ייצוא ל-Word בפורמט שלכם',
    steps: [
      {
        id: 'p-intro',
        sel: '.nav a.user',
        title: 'Pouch: ייצוא בפורמט שלכם',
        body: 'Pouch מייצא תמציות למסמך Word שנראה בדיוק כמו שתרצו: מעצבים פורמט פעם אחת, והתמציות נכנסות אליו. הפורמטים נמצאים בפרופיל.',
        added: '2026-11-23',
        when: (ctx) => ctx.feature('pouch'),
        do: { hint: 'לחצו על השם שלכם כדי לעבור לפרופיל', until: (ctx) => path(ctx).startsWith('/profile/') },
      },
      {
        id: 'p-tab',
        sel: POUCH_TAB,
        title: 'הפורמטים שלכם',
        body: 'כאן, ליד החיפושים השמורים, נמצאים הפורמטים שיצרתם ואלה שאחרים שיתפו אתכם.',
        arrive: 'אתם עכשיו בפרופיל שלכם',
        added: '2026-11-23',
        prep: async (ctx) => {
          await ctx.go(`/profile/${ctx.userId()}`);
          await reveal('app-profile-shelf');
        },
        when: (ctx) => ctx.feature('pouch'),
        do: { hint: 'פתחו את "פורמטים לייצוא"', until: () => !!$(`${POUCH_TAB}.active`) },
      },
      {
        id: 'p-new',
        sel: 'app-profile-shelf [aria-label="פורמט חדש"]',
        title: 'פורמט חדש',
        body: 'הפלוס פותח את Pouch: כותבים מסמך רגיל ומשבצים בו שדות מהתמצית, כמו כותרת, תאריך ותוכן.',
        tip: 'ייצוא: "בחירה" ברשימת התמציות ← "ייצוא" ← "פורמט אישי".',
        added: '2026-11-23',
        prep: async (ctx) => {
          await ctx.go(`/profile/${ctx.userId()}`);
          if (!$(`${POUCH_TAB}.active`)) await click(POUCH_TAB, 120);
          await reveal('app-profile-shelf');
        },
        when: (ctx) => ctx.feature('pouch'),
      },
    ],
  },

  // ---- more topics, from the hub
  {
    id: 'basics',
    title: 'קריאה וכתיבה',
    desc: 'פתיחת תמצית, תצוגות, תמצית חדשה והתראות',
    steps: [
      {
        id: 'b-open',
        sel: '.feed-scroller',
        title: 'פתיחת תמצית',
        body: 'לחיצה על תמצית פותחת אותה בצד, בלי לאבד את המקום ברשימה. לחיצה נוספת סוגרת.',
        prep: (ctx) => ctx.go('/summaries'),
        do: { hint: 'לחצו על תמצית כלשהי', until: summaryOpen },
      },
      {
        id: 'b-detail',
        sel: 'app-summary-detail',
        title: 'התמצית בצד',
        body: 'כאן קוראים את התמצית ומגיבים. את רוחב החלונית אפשר לשנות בגרירה.',
        tip: 'כפתור מסך מלא פותח את התמצית בעמוד משלה, עם קישור לשיתוף.',
      },
      {
        id: 'b-view',
        sel: 'nz-radio-group[aria-label="תצוגה"]',
        title: 'כרטיסים או טבלה',
        body: 'אותה רשימה בשתי תצוגות: כרטיסים לקריאה, טבלה לסריקה מהירה.',
        kbd: [`${alt('listView')} כרטיסים`, `${alt('tableView')} טבלה`],
      },
      {
        id: 'b-new',
        sel: altSel('newSummary'),
        title: 'תמצית חדשה',
        body: 'בוחרים סוג תוכן, ממלאים ושומרים — או שומרים כטיוטה וממשיכים אחר כך.',
        kbd: [alt('newSummary')],
      },
      {
        id: 'b-bell',
        sel: altSel('notificationsBell'),
        title: 'התראות',
        body: 'כאן מגיעות ההתראות על חיפושים שמורים. "דף ההתראות" שבחלונית מרכז את כולן.',
        kbd: [alt('notificationsBell')],
      },
    ],
  },
  {
    id: 'search-more',
    title: 'עוד בחיפוש',
    desc: 'כמוסות, שיתוף, מיון וקפיצה בזמן',
    steps: [
      {
        id: 's-capsules',
        sel: SEARCH_BOX,
        title: 'כמוסות',
        body: '# פותח רשימת כמוסות: קבוצות מילים שמורות שנכנסות לחיפוש כיחידה אחת. כל מילה בכמוסה היא חובה, רשות או אסורה.',
        tip: 'כמוסות עובדות גם בחיפוש המתקדם ובהתראות.',
        added: '2026-10-26',
        prep: (ctx) => ctx.go('/summaries'),
      },
      {
        id: 's-alert',
        sel: [altSel('alertSearch'), SEARCH_BOX],
        title: 'התראה ושיתוף',
        body: 'אחרי חיפוש, הפעמון שבתיבה מתריע על כל תמצית חדשה שמתאימה. כפתור השיתוף מעתיק קישור לחיפוש.',
        kbd: [`${alt('alertSearch')} התראה`, `${alt('shareSearch')} קישור`],
        added: '2026-10-26',
      },
      {
        id: 's-sort',
        sel: 'app-sort-row',
        title: 'מיון',
        body: 'בוחרים לפי מה למיין, והחץ שלצד השדה הופך את הכיוון.',
      },
      {
        id: 's-rail',
        sel: 'app-scroll-rail',
        title: 'קפיצה בזמן',
        body: 'הפס שלצד הרשימה מראה איפה אתם בה; גוררים אותו כדי לקפוץ, והתאריך מוצג תוך כדי.',
      },
      {
        id: 'h-new',
        sel: 'app-folder-tree .root [aria-label="תיקייה חדשה"]',
        title: 'תיקייה חדשה',
        body: 'יוצר תיקייה ברמה העליונה; תיקיות משנה יוצרים בקליק ימני על תיקייה.',
        added: '2026-10-24',
      },
      {
        id: 'h-handle',
        sel: '.nav-handle',
        title: 'רוחב התפריט',
        body: 'גוררים את המפריד כדי לשנות את רוחב התפריט והעץ.',
        added: '2026-10-24',
      },
    ],
  },
  {
    id: 'select',
    title: 'בחירה וייצוא',
    desc: 'פעולות על כמה תמציות יחד, Excel ו-Word',
    steps: [
      {
        id: 'x-select',
        sel: altSel('selectMode'),
        title: 'מצב בחירה',
        body: 'מוסיף תיבת סימון לכל תמצית ברשימה.',
        kbd: [alt('selectMode')],
        prep: (ctx) => ctx.go('/summaries'),
        do: { hint: 'לחצו על "בחירה"', until: () => !!$('app-summary-actions-bar .count') },
      },
      {
        id: 'x-actions',
        sel: 'app-summary-actions-bar',
        title: 'מה עושים עם הנבחרות',
        body: 'תיקייה, תגיות, צבע, ציר זמן וייצוא ל-Excel, ל-Word או לפורמט אישי של Pouch.',
        tip: 'בלי בחירה, הייצוא כולל את כל תוצאות החיפוש.',
      },
      {
        id: 'x-excel',
        sel: ['app-summary-actions-bar .excel', 'app-summary-actions-bar'],
        title: 'העלאה מ-Excel',
        body: 'מורידים תבנית לסוג התוכן, ממלאים בה כמה תמציות ומעלים את כולן בבת אחת.',
        prep: async (ctx) => {
          await ctx.go('/summaries');
          await click('app-summary-actions-bar .close', 120);
        },
      },
    ],
  },
  {
    id: 'notifications',
    title: 'התראות',
    desc: 'לדעת כשנכתבת תמצית שמעניינת אתכם',
    steps: [
      {
        id: 'n-rules',
        sel: 'app-notifications-settings .panel .list',
        title: 'ההתראות שלי',
        body: 'כל התראה היא על חיפוש שמור: כשתמצית חדשה מתאימה לו — מקבלים התראה במערכת, במייל או בשניהם. כאן משהים, עורכים ומבטלים.',
        tip: 'בצד השני של הדף: כל התמציות שקיבלתם עליהן התראה.',
        arrive: 'אתם עכשיו בדף ההתראות',
        added: '2026-11-05',
        prep: (ctx) => ctx.go('/notifications'),
      },
      {
        id: 'n-new',
        sel: 'app-notifications-settings .panel-header [nztype="primary"]',
        title: 'התראה חדשה',
        body: 'חיפוש חדש עם התראה: טקסט או תנאים, ואיך לקבל את ההתראה.',
      },
      {
        id: 'n-shared',
        sel: 'app-notifications-settings .panel .tabs',
        title: 'חיפושים משותפים',
        body: 'ב"החיפושים שלי" משתפים חיפוש עם כולם. ב"משותפים" — מה שאחרים שיתפו: מריצים, מקבלים עליו התראה או שומרים עותק.',
        added: '2026-11-18',
      },
    ],
  },
  {
    id: 'personal',
    title: 'פרופיל והעדפות',
    desc: 'חיפושים שמורים, קבוצות משתמשים והעדפות',
    steps: [
      {
        id: 'p-shelf',
        sel: 'app-profile-shelf',
        title: 'המדף בפרופיל',
        body: 'החיפושים השמורים, קבוצות המשתמשים והפורמטים, בלשוניות. קליק ימני על כרטיס — מועדף, התראה, שיתוף, עריכה.',
        arrive: 'אתם עכשיו בפרופיל שלכם',
        added: '2026-11-18',
        prep: async (ctx) => {
          await ctx.go(`/profile/${ctx.userId()}`);
          await reveal('app-profile-shelf');
        },
      },
      {
        id: 'p-groups',
        sel: 'app-profile-shelf .tabs',
        title: 'קבוצות משתמשים',
        body: 'שם לכמה משתמשים יחד. בשדה "תיוג" בתמצית, בחירת קבוצה מתייגת את כל החברים בה.',
        added: '2026-11-18',
      },
      {
        id: 'p-prefs',
        sel: '[aria-label="העדפות"]',
        title: 'העדפות',
        body: 'גלגל השיניים שליד הפעמון: האם החיפוש נשמר במעבר בין תיקיות, וזמנים יחסיים או תאריך ושעה.',
        arrive: 'אתם עכשיו ב"כל התמציות"',
        added: '2026-11-18',
        prep: (ctx) => ctx.go('/summaries'),
      },
    ],
  },
  {
    id: 'keys',
    title: 'מקלדת',
    desc: 'לעבוד בלי עכבר',
    steps: [
      {
        id: 'k-alt',
        title: 'רמזי מקשים',
        body: 'החזקת Alt מציגה על כל כפתור את המקש שלו, ו-Alt + המקש מפעיל אותו — גם במקלדת עברית.',
        kbd: ['Alt'],
      },
      {
        id: 'k-list',
        title: 'כל הקיצורים',
        body: 'רשימה של כל קיצורי המקלדת, לפי נושא.',
        kbd: [alt('help')],
        action: { label: 'הצגת כל הקיצורים', run: (ctx) => ctx.showShortcuts() },
      },
      {
        id: 'k-tour',
        title: 'הסיור עצמו',
        body: 'בזמן סיור: חצים לצעד הבא והקודם, Esc לסגירה.',
        kbd: ['← הבא', '→ הקודם', 'Esc סגירה'],
      },
    ],
  },
];
