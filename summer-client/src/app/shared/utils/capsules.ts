import { CapsuleCondition, ICapsule, IQueryGroup } from '../models';

/** Names compare case-insensitively, with `_` (as typed in the search box) standing for spaces. */
export const normalizeCapsuleName = (s: string) => s.replace(/[_\s]+/g, ' ').trim().toLowerCase();

/** How a capsule is written in the search box: `#name`, `_` for spaces. */
export const capsuleSearchToken = (c: Pick<ICapsule, 'name'>) => `#${c.name.trim().replace(/\s+/g, '_')}`;

/** How a capsule is stored in advanced-search word lists. */
export const CAPSULE_TOKEN = '#cap:';
export const isCapsuleToken = (w: string) => w.startsWith(CAPSULE_TOKEN);
export const capsuleTokenId = (w: string) => w.slice(CAPSULE_TOKEN.length);
export const capsuleIdToken = (id: string) => CAPSULE_TOKEN + id;

export const CONDITIONS: { key: CapsuleCondition; label: string; hint: string }[] = [
  { key: 'must', label: 'חובה', hint: 'כל המילים חייבות להופיע' },
  { key: 'optional', label: 'רשות', hint: 'מספיקה אחת מהן' },
  { key: 'mustNot', label: 'אסור', hint: 'אף אחת מהן לא תופיע' },
];

export const wordsOf = (c: ICapsule, condition: CapsuleCondition) => c.words.filter((w) => w.condition === condition).map((w) => w.word);

/** The words a match is made of, for highlighting (mustNot words never appear in a match). */
export const positiveWords = (c: ICapsule) => c.words.filter((w) => w.condition !== 'mustNot').map((w) => w.word);

/** Capsule ids in an advanced-search tree. */
export function treeCapsuleIds(q: IQueryGroup | undefined): string[] {
  if (!q) return [];
  return q.children.flatMap((c) => (c.type === 'group' ? treeCapsuleIds(c) : (c.words ?? []).filter(isCapsuleToken).map(capsuleTokenId)));
}
