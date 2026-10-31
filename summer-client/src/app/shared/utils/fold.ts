/**
 * Characters search treats as the same, kept in sync with the server's foldText (common/sql.ts): Hebrew final
 * letters and their regular forms, geresh / gershayim and typographic quotes with ' and ".
 */
const GROUPS = ['כך', 'מם', 'נן', 'פף', 'צץ', `'׳‘’`, `"״“”`];

const CLASS = new Map(GROUPS.flatMap((g) => [...g].map((c) => [c, `[${g}]`] as const)));

/** An escaped regex source with each foldable character widened to its group, e.g. סף → ס[פף]. */
export const foldPattern = (escaped: string) => [...escaped].map((c) => CLASS.get(c) ?? c).join('');
