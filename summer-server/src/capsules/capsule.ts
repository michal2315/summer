/**
 * Capsules (כמוסות): named word lists kept by an external service, used in searches and notification rules
 * instead of typing the words each time. Each word carries a condition:
 * - must: every one has to appear
 * - mustNot: none may appear
 * - optional: when the capsule has no must words, at least one has to appear; otherwise they only add highlights
 */
export const CAPSULE_CONDITIONS = ['must', 'mustNot', 'optional'] as const;
export type CapsuleCondition = (typeof CAPSULE_CONDITIONS)[number];

export interface CapsuleWord {
  word: string;
  condition: CapsuleCondition;
}

export interface Capsule {
  id: string;
  name: string;
  description: string;
  words: CapsuleWord[];
}

/** Adapter boundary for the external capsule service. Unknown ids / names are simply left out of the result. */
export abstract class CapsuleProvider {
  /** Name match: prefix matches first, then contains. Empty `q` lists everything (up to `limit`). */
  abstract search(q: string, limit: number): Promise<Capsule[]>;
  abstract byIds(ids: string[]): Promise<Capsule[]>;
  abstract byNames(names: string[]): Promise<Capsule[]>;
}

/** In the search box a capsule is `#name`, `_` for spaces; names compare case-insensitively. */
export const normalizeCapsuleName = (s: string) => s.replace(/[_\s]+/g, ' ').trim().toLowerCase();

/** In advanced-search word lists a capsule is stored as `#cap:<id>`. */
export const CAPSULE_TOKEN = '#cap:';
export const isCapsuleToken = (w: string) => w.startsWith(CAPSULE_TOKEN);
export const capsuleTokenId = (w: string) => w.slice(CAPSULE_TOKEN.length);

/** Capsules fetched for one request. */
export interface CapsuleLookup {
  byId(id: string): Capsule | undefined;
  byName(name: string): Capsule | undefined;
}

export function capsuleLookup(list: Capsule[]): CapsuleLookup {
  const ids = new Map(list.map((c) => [c.id, c]));
  const names = new Map(list.map((c) => [normalizeCapsuleName(c.name), c]));
  return { byId: (id) => ids.get(id), byName: (name) => names.get(normalizeCapsuleName(name)) };
}

export const NO_CAPSULES: CapsuleLookup = capsuleLookup([]);

export const wordsOf = (c: Capsule, condition: CapsuleCondition) => c.words.filter((w) => w.condition === condition).map((w) => w.word);

/** The capsule's rule over plain text (case-insensitive substring), as the SQL search applies it. */
export function capsuleMatchesText(c: Capsule, text: string): boolean {
  const hay = text.toLowerCase();
  const has = (w: string) => hay.includes(w.toLowerCase());
  const must = wordsOf(c, 'must');
  const optional = wordsOf(c, 'optional');
  if (!must.length && !optional.length) return false;
  return must.every(has) && !wordsOf(c, 'mustNot').some(has) && (must.length > 0 || optional.some(has));
}
