/**
 * Every Alt shortcut in the app: the help overlay lists these, and `appAltKey="<id>"` binds one to the element it sits on.
 * Keys are physical (KeyboardEvent.code), so they work the same on a Hebrew layout.
 * Avoid Alt+D/E/F (browser address bar and menus) and Alt+arrows (history).
 */
export const ALT_KEYS = {
  search: { key: 'G', label: 'מעבר לתיבת החיפוש', group: 'חיפוש' },
  advancedSearch: { key: 'X', label: 'חיפוש מתקדם — פתיחה / סגירה', group: 'חיפוש' },
  pinSearch: { key: 'S', label: 'נעיצת החיפוש הנוכחי', group: 'חיפוש' },
  clearSearch: { key: 'Shift+X', label: 'ניקוי החיפוש', group: 'חיפוש' },

  newSummary: { key: 'N', label: 'תמצית חדשה', group: 'תמציות' },
  selectMode: { key: 'M', label: 'בחירה מרובה', group: 'תמציות' },
  listView: { key: 'L', label: 'תצוגת כרטיסים', group: 'תמציות' },
  tableView: { key: 'T', label: 'תצוגת טבלה', group: 'תמציות' },
  notificationsBell: { key: 'B', label: 'התראות אחרונות', group: 'תמציות' },

  home: { key: '1', label: 'דף הבית', group: 'עמודים' },
  profile: { key: '2', label: 'פרופיל', group: 'עמודים' },
  collections: { key: '3', label: 'לקטים', group: 'עמודים' },
  hierarchy: { key: '4', label: 'היררכיה', group: 'עמודים' },
  notifications: { key: '5', label: 'התראות', group: 'עמודים' },
  permissions: { key: '6', label: 'הרשאות', group: 'עמודים' },
  extension: { key: '7', label: 'תוסף', group: 'עמודים' },
  dashboard: { key: '8', label: 'דשבורד', group: 'עמודים' },

  help: { key: '/', label: 'כל קיצורי המקלדת', group: 'עזרה' },
  tour: { key: 'Q', label: 'סיור ועזרה', group: 'עזרה' },
} as const satisfies Record<string, { key: string; label: string; group: string }>;

export type AltKeyId = keyof typeof ALT_KEYS;

/** KeyboardEvent → the `key` notation above ('X', 'Shift+X', '1', '/'), or null for keys we don't bind. */
export function comboOf(e: KeyboardEvent): string | null {
  const m = /^(?:Key([A-Z])|Digit(\d))$/.exec(e.code);
  const base = m ? (m[1] ?? m[2]) : e.code === 'Slash' ? '/' : null;
  if (!base) return null;
  return (e.shiftKey ? 'Shift+' : '') + base;
}
