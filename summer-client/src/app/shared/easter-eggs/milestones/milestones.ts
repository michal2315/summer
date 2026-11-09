import { SUMMARY_COLORS } from '../../models/colors';

/**
 * Display data for the profile milestones, in display order. Whether each is earned is decided by the server
 * (summer-server src/milestones/milestones.repository.ts), over all of the author's published summaries — keep the ids in sync.
 */
export interface Milestone {
  id: string;
  emoji: string;
  title: string;
  /** How to earn it — shown in the tooltip, also while still locked. */
  hint: string;
}

export const MILESTONES: Milestone[] = [
  // ---- how many ----
  { id: 'first', emoji: '🌱', title: 'צעד ראשון', hint: 'פרסום התמצית הראשונה' },
  { id: 'ten', emoji: '🔟', title: 'עשירייה', hint: '10 תמציות שפורסמו' },
  { id: 'fifty', emoji: '🏅', title: 'חצי מאה', hint: '50 תמציות שפורסמו' },
  { id: 'hundred', emoji: '💯', title: 'מאה!', hint: '100 תמציות שפורסמו' },

  // ---- when ----
  { id: 'night-owl', emoji: '🦉', title: 'ינשוף לילה', hint: 'תמצית שנכתבה בין חצות ל-5 בבוקר' },
  { id: 'early-bird', emoji: '🐦', title: 'הציפור המוקדמת', hint: 'תמצית שנכתבה בין 5 ל-7 בבוקר' },
  { id: 'midnight', emoji: '🕛', title: 'חצות בדיוק', hint: 'תמצית שנכתבה ב-00:00' },
  { id: 'weekend', emoji: '🏖️', title: 'גם בשבת?!', hint: 'תמצית שנכתבה בשבת' },
  { id: 'summer', emoji: '☀️', title: 'שמש של קיץ', hint: 'תמצית שנכתבה ביולי או באוגוסט' },
  { id: 'birthday', emoji: '🎂', title: 'יום הולדת ל-Summer', hint: 'תמצית שנכתבה ב-24 באוקטובר, יום ההולדת של Summer' },
  { id: 'streak', emoji: '🔥', title: '7 ימים ברצף', hint: 'תמציות ב-7 ימים רצופים' },
  { id: 'full-week', emoji: '📅', title: 'שבוע מלא', hint: 'תמציות ב-5 ימים שונים באותו שבוע' },
  { id: 'live', emoji: '⚡', title: 'בזמן אמת', hint: 'תמצית שנכתבה ביום האירוע עצמו' },
  { id: 'archaeology', emoji: '⏳', title: 'ארכיאולוגיה', hint: 'תמצית על אירוע שקרה יותר משנה לפני שנכתבה' },
  { id: 'rewrite', emoji: '📝', title: 'שכתוב', hint: 'עריכת תמצית יותר מחודש אחרי שנכתבה' },

  // ---- what ----
  { id: 'marathon', emoji: '🏃', title: 'מרתון', hint: 'פתיחת תמצית רצף' },
  { id: 'long-run', emoji: '🔁', title: 'רצף ארוך', hint: 'תמצית רצף עם 20 תמציתוניות ומעלה' },
  { id: 'linked', emoji: '🔗', title: 'הכול מקושר', hint: 'תמציתונית עם קישור' },
  { id: 'rainbow', emoji: '🌈', title: 'קשת בענן', hint: 'תמציות ב-5 צבעים שונים' },
  { id: 'all-colors', emoji: '🎨', title: 'כל הצבעים', hint: `תמציות בכל ${SUMMARY_COLORS.length} הצבעים` },
  { id: 'all-types', emoji: '🧩', title: 'כל הסוגים', hint: 'תמציות מכל סוגי התוכן' },
  { id: 'labels', emoji: '🏷️', title: 'אספנות תגיות', hint: '10 תגיות שונות בתמציות' },
  { id: 'files', emoji: '📎', title: 'אספנות קבצים', hint: 'תמצית עם 3 קבצים מצורפים ומעלה' },
  { id: 'team', emoji: '🤝', title: 'עבודת צוות', hint: 'תיוג 5 אנשים ומעלה בתמצית אחת' },
  { id: 'organized', emoji: '🗂️', title: 'סדר מופתי', hint: '3 תמציות שלך מסודרות בתיקיות' },

  // ---- how long ----
  { id: 'epic', emoji: '📜', title: 'אפוס', hint: 'תמצית של יותר מ-5,000 תווים' },
  { id: 'tldr', emoji: '✂️', title: 'TL;DR', hint: 'תמצית של פחות מ-140 תווים' },
  { id: 'exactly-100', emoji: '📏', title: 'בדיוק 100', hint: 'תמצית של 100 תווים בדיוק' },

  // ---- people ----
  { id: 'talk', emoji: '💬', title: 'על זה מדברים', hint: 'תמצית עם 5 תגובות ומעלה' },
  { id: 'self-talk', emoji: '🪞', title: 'שיחה עם עצמי', hint: 'תגובה על תמצית שלך' },
  { id: 'popular', emoji: '👀', title: 'כולם קוראים', hint: 'תמצית ש-20 אנשים צפו בה' },
];
