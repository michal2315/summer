import { ALT_KEYS, AltKeyId } from '../keyboard/alt-keys';

/** What a step's prep / do / action may use to drive the app. Implemented by TourService. */
export interface TourContext {
  /** Navigate to a path (no-op when already there, query params ignored), then wait for the page to render. */
  go(path: string): Promise<void>;
  /** The current router URL, query included. */
  url(): string;
  userId(): string | null;
  showShortcuts(): void;
}

/**
 * One tour step.
 * - `sel`: CSS selector(s) of the element to spotlight — the first visible, clickable match wins. Omit for a centered card.
 * - `kbd`: shortcuts as 'Alt+G' or 'Alt+G label'.
 * - `do`: the user performs it; the tour moves on by itself once `until()` is true.
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
  do?: { hint: string; until: (ctx: TourContext) => boolean };
  action?: { label: string; run: (ctx: TourContext) => void };
  added?: string;
}

export interface TourTopic {
  id: string;
  title: string;
  desc: string;
  /** The basics tour: offered first and shown automatically on a first visit. */
  core?: boolean;
  steps: TourStep[];
}

/** How long a step with `added` counts as new. */
export const NEW_DAYS = 30;

const alt = (id: AltKeyId) => `Alt+${ALT_KEYS[id].key}`;
/** The element bound to an Alt shortcut (AltKeyDirective sets aria-keyshortcuts). */
const altSel = (id: AltKeyId) => `[aria-keyshortcuts="${alt(id)}"]`;
const summaryOpen = (ctx: TourContext) => /[?&]summaryId=/.test(ctx.url());

export const WELCOME_STEP: TourStep = {
  id: '_welcome',
  title: 'ברוכים הבאים ל-Summer',
  body: 'סיור קצר על הבסיס: התפריט, החיפוש, פתיחת תמצית וכתיבה. באחד הצעדים תתבקשו לעשות בעצמכם.',
  tip: 'אפשר לצאת בכל רגע עם Esc ולחזור מכפתור "סיור ועזרה" בתחתית התפריט.',
};

/**
 * The guided tour, the hub's topics and the what's-new nudge all come from here.
 * RULE: every new feature adds a step (in the right topic) with `added: 'YYYY-MM-DD'`.
 * `id`s are remembered per user as seen — keep them stable.
 */
export const TOUR_TOPICS: TourTopic[] = [
  {
    id: 'basics',
    core: true,
    title: 'סיור בסיס',
    desc: 'תפריט, חיפוש, תמציות וכתיבה · כ-2 דקות',
    steps: [
      {
        id: 'b-nav',
        sel: '.nav .links',
        title: 'התפריט',
        body: 'כל עמודי Summer: דף הבית עם כל התמציות, הפרופיל שלכם, היררכיה, התראות והרשאות.',
        tip: 'לכל עמוד יש קיצור Alt + ספרה, לפי הסדר בתפריט.',
        kbd: [`${alt('home')} דף הבית`, `${alt('profile')} פרופיל`],
        prep: (ctx) => ctx.go('/summaries'),
      },
      {
        id: 'b-search',
        sel: altSel('search'),
        title: 'חיפוש',
        body: 'מחפש בכל התמציות תוך כדי הקלדה — בכותרת, בתוכן ובשדות.',
        tip: '@ מסנן לפי כותב/ת, : לפי סוג תוכן, ואפשר לחבר מילים עם וגם / או / לא.',
        kbd: [alt('search'), '/ מכל מקום'],
      },
      {
        id: 'b-advanced',
        sel: altSel('advancedSearch'),
        title: 'חיפוש מתקדם',
        body: 'כשמילה אחת לא מספיקה: בונים שאילתה מתנאים וקבוצות, עם וגם / או, על שדות התמצית.',
        kbd: [alt('advancedSearch')],
      },
      {
        id: 'b-view',
        sel: 'nz-radio-group[aria-label="תצוגה"]',
        title: 'כרטיסים או טבלה',
        body: 'אותה רשימה בשתי תצוגות: כרטיסים לקריאה, טבלה לסריקה מהירה של הרבה תמציות.',
        kbd: [`${alt('listView')} כרטיסים`, `${alt('tableView')} טבלה`],
      },
      {
        id: 'b-open',
        sel: '.feed-scroller',
        title: 'פתיחת תמצית',
        body: 'לחיצה על תמצית פותחת אותה בצד, בלי לאבד את המקום ברשימה. לחיצה נוספת סוגרת.',
        do: { hint: 'לחצו על תמצית כלשהי', until: summaryOpen },
      },
      {
        id: 'b-detail',
        sel: 'app-summary-detail',
        title: 'התמצית בצד',
        body: 'כאן קוראים את התמצית ומגיבים. את רוחב החלונית אפשר לשנות בגרירה.',
        tip: 'כפתור מסך מלא פותח את התמצית בעמוד משלה — עם קישור לשיתוף.',
      },
      {
        id: 'b-new',
        sel: altSel('newSummary'),
        title: 'תמצית חדשה',
        body: 'בוחרים סוג תוכן, ממלאים את השדות ושומרים — או שומרים כטיוטה וממשיכים אחר כך.',
        kbd: [alt('newSummary')],
      },
      {
        id: 'b-bell',
        sel: altSel('notificationsBell'),
        title: 'התראות',
        body: 'תמציות חדשות שעונות על כללי ההתראה שלכם. את הכללים מגדירים בעמוד ההתראות.',
        kbd: [alt('notificationsBell')],
      },
      {
        id: 'b-help',
        sel: '.tour-btn',
        title: 'תמיד אפשר לחזור',
        body: 'כאן הסיור ונושאים נוספים: חיפוש לעומק, בחירה וייצוא, היררכיה, תמציות רצף ועוד.',
        tip: 'נקודה ורודה על הכפתור = יש משהו חדש שעוד לא ראיתם.',
        kbd: [alt('tour')],
      },
    ],
  },
  {
    id: 'search',
    title: 'חיפוש לעומק',
    desc: 'תחביר, חיפושים נעוצים ומיון',
    steps: [
      {
        id: 's-syntax',
        sel: altSel('search'),
        title: 'תחביר החיפוש',
        body: '@שם מציג תמציות של כותב/ת, :סוג מסנן לפי סוג תוכן, "מירכאות" שומרות ביטוי שלם, ו-וגם / או / לא מחברים בין מילים.',
        tip: 'כל חלק בתיבה נצבע לפי התפקיד שלו, וההשלמה האוטומטית נפתחת תוך כדי הקלדה.',
        added: '2026-10-26',
        prep: (ctx) => ctx.go('/summaries'),
      },
      {
        id: 's-capsules',
        sel: altSel('search'),
        title: 'כמוסות',
        body: '# פותח רשימת כמוסות: קבוצות מילים שמורות שנכנסות לחיפוש כיחידה אחת. כל מילה בכמוסה היא חובה, רשות או אסורה.',
        tip: 'כמוסות עובדות גם בחיפוש המתקדם ובכללי התראה. לחיצה על כמוסה מציגה את המילים שבה.',
        added: '2026-10-26',
        prep: (ctx) => ctx.go('/summaries'),
      },
      {
        id: 's-alert',
        sel: [altSel('alertSearch'), altSel('search')],
        title: 'התראה על חיפוש ושיתוף',
        body: 'אחרי חיפוש, הפעמון שבתיבה שולח התראה בכל פעם שתמצית חדשה (או שנערכה) מתאימה לחיפוש. כפתור השיתוף מעתיק קישור לחיפוש.',
        kbd: [`${alt('alertSearch')} התראה`, `${alt('shareSearch')} קישור`],
        added: '2026-10-26',
      },
      {
        id: 's-capsules-page',
        sel: altSel('capsules'),
        title: 'עמוד הכמוסות',
        body: 'כל הכמוסות והמילים שבהן, לפי חובה / רשות / אסור. משם אפשר לחפש עם כמוסה או ליצור עליה התראה.',
        kbd: [alt('capsules')],
        added: '2026-10-26',
      },
      {
        id: 's-history',
        sel: altSel('search'),
        title: 'חיפושים אחרונים ונעוצים',
        body: 'לחיצה על תיבה ריקה מציגה את החיפושים האחרונים והנעוצים, וגם קיצורי חיפוש מוכנים.',
        tip: 'אחרי חיפוש, הנעץ שבתיבה שומר אותו כנעוץ.',
        kbd: [`${alt('pinSearch')} נעיצה`, `${alt('clearSearch')} ניקוי`],
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
    ],
  },
  {
    id: 'select',
    title: 'בחירה וייצוא',
    desc: 'פעולות על כמה תמציות יחד, ו-Excel',
    steps: [
      {
        id: 'x-excel',
        sel: ['app-summary-actions-bar .excel', 'app-summary-actions-bar'],
        title: 'Excel',
        body: 'מורידים תבנית לסוג התוכן, ממלאים בה כמה תמציות ומעלים את כולן בבת אחת. מכאן גם מייצאים את כל תוצאות החיפוש.',
        prep: (ctx) => ctx.go('/summaries'),
      },
      {
        id: 'x-select',
        sel: altSel('selectMode'),
        title: 'מצב בחירה',
        body: 'מוסיף תיבת סימון לכל תמצית ברשימה.',
        kbd: [alt('selectMode')],
        do: { hint: 'לחצו על "בחירה"', until: () => !!document.querySelector('app-summary-actions-bar .count') },
      },
      {
        id: 'x-actions',
        sel: 'app-summary-actions-bar',
        title: 'מה עושים עם הנבחרות',
        body: 'תיקייה, תגיות, צבע, ציר זמן וייצוא ל-Excel או ל-Word. מועדפים, טיוטה ומחיקה — בתפריט ⋯.',
        tip: 'תיבת הסימון שליד המונה בוחרת בבת אחת את כל מה שנטען ברשימה.',
      },
    ],
  },
  {
    id: 'hierarchy',
    title: 'תיקיות',
    desc: 'עץ התיקיות שבדף הבית',
    steps: [
      {
        id: 'h-tree',
        sel: 'app-hierarchy-page .tree',
        title: 'עץ התיקיות',
        body: 'לחיצה על תיקייה מציגה את כל התמציות שבה ובתיקיות המשנה, והחיפוש פועל בתוכן. "ללא תיקייה" מציג את מה שלא שויך.',
        added: '2026-10-24',
        prep: (ctx) => ctx.go('/summaries'),
      },
      {
        id: 'h-new',
        sel: 'app-hierarchy-page .tree-head [aria-label="תיקייה חדשה"]',
        title: 'תיקייה חדשה',
        body: 'יוצר תיקייה ברמה העליונה; תיקיות משנה ופריטים מוסיפים מתוך כל תיקייה.',
        added: '2026-10-24',
      },
      {
        id: 'h-handle',
        sel: 'app-hierarchy-page .handle',
        title: 'רוחב העץ',
        body: 'גוררים את המפריד כדי לשנות את רוחב העץ. גם החצים במקלדת עובדים כשהוא בפוקוס.',
        added: '2026-10-24',
      },
    ],
  },
  {
    id: 'running',
    title: 'תמציות רצף',
    desc: 'נושא מתמשך שמתעדכן בתמציתוניות',
    steps: [
      {
        id: 'r-what',
        title: 'מה זו תמצית רצף',
        body: 'תמצית שמלווה נושא לאורך זמן. כל עדכון נכתב כתמציתונית קצרה, והרצף מציג את כולן יחד — ברשימה או על ציר זמן.',
        added: '2026-10-24',
        prep: (ctx) => ctx.go('/summaries'),
      },
      {
        id: 'r-card',
        sel: '.running-banner',
        title: 'ברשימה',
        body: 'תמצית רצף מסומנת בפס עליון עם מספר התמציתוניות וטווח התאריכים. תמציתונית מראה מאיזה רצף היא באה.',
        added: '2026-10-24',
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
        sel: 'app-notifications-settings .list',
        title: 'כללי התראה',
        body: 'כל כלל מגדיר תנאים על שדות התמצית. כשתמצית חדשה עומדת בכולם — מקבלים התראה במערכת, במייל או בשניהם.',
        kbd: [alt('notifications')],
        prep: (ctx) => ctx.go('/notifications'),
      },
      {
        id: 'n-new',
        sel: 'app-notifications-settings .header [nztype="primary"]',
        title: 'התראה חדשה',
        body: 'בוחרים סוג תוכן, מוסיפים תנאים ובוחרים איך לקבל את ההתראה.',
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
