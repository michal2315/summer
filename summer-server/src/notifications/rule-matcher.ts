import { CapsuleLookup, NO_CAPSULES, capsuleMatchesText } from '../capsules/capsule';
import { searchKey } from '../common/sql';
import { RuleCondition } from '../database/schema';

export const RULE_FUNCTIONS = [
  'stringContains',
  'stringNotContains',
  'numberBigger',
  'numberSmaller',
  'numberEqual',
  'numberBetween',
  'dateAfter',
  'dateBefore',
  'dateBetween',
  'arrayContains',
  'arrayNotContains',
  /** content: [capsule id, capsule name] (the name is only for display) */
  'capsuleMatches',
  'capsuleNotMatches',
] as const;

export const CAPSULE_FUNCTIONS: readonly string[] = ['capsuleMatches', 'capsuleNotMatches'];

/** Not a catalog field: a rule condition on it reads the summary's title, content and notes. */
export const SUMMARY_TEXT_FIELD = { _id: 'summary-text', name: 'תוכן התמצית', type: 'string' } as const;

type Operand = string | number | null | undefined;

const num = (v: Operand) => (v === null || v === undefined || v === '' ? null : Number(v));
const time = (v: Operand) => (v === null || v === undefined || v === '' ? null : new Date(v).getTime());

/** Array-typed field values are stored as JSON arrays or comma-separated text. */
function listOf(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // not JSON
  }
  return value
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

/** `null`/empty bound = open-ended (the UI's ∞). */
function between(x: number, lo: number | null, hi: number | null): boolean {
  return (lo === null || x >= lo) && (hi === null || x <= hi);
}

/** One condition against a summary's value for that field. A missing value, or a capsule that no longer exists, never matches. */
export function matchCondition(c: RuleCondition, value: string | undefined, capsules: CapsuleLookup = NO_CAPSULES): boolean {
  if (value === undefined || value === '') return false;
  const [a, b] = c.content;
  switch (c.funcName) {
    case 'stringContains':
      return a !== null && a !== undefined && searchKey(value).includes(searchKey(String(a)));
    case 'stringNotContains':
      return a !== null && a !== undefined && !searchKey(value).includes(searchKey(String(a)));
    case 'numberBigger':
    case 'numberSmaller':
    case 'numberEqual':
    case 'numberBetween': {
      const x = Number(value);
      const lo = num(a);
      if (!Number.isFinite(x)) return false;
      if (c.funcName === 'numberBetween') return between(x, lo, num(b));
      if (lo === null || !Number.isFinite(lo)) return false;
      return c.funcName === 'numberBigger' ? x > lo : c.funcName === 'numberSmaller' ? x < lo : x === lo;
    }
    case 'dateAfter':
    case 'dateBefore':
    case 'dateBetween': {
      const x = new Date(value).getTime();
      const lo = time(a);
      if (Number.isNaN(x)) return false;
      if (c.funcName === 'dateBetween') return between(x, lo, time(b));
      if (lo === null || Number.isNaN(lo)) return false;
      return c.funcName === 'dateAfter' ? x > lo : x < lo;
    }
    case 'arrayContains':
    case 'arrayNotContains': {
      const has = listOf(value).includes(String(a ?? ''));
      return c.funcName === 'arrayContains' ? has : !has;
    }
    case 'capsuleMatches':
    case 'capsuleNotMatches': {
      const capsule = capsules.byId(String(a ?? ''));
      if (!capsule) return false;
      return capsuleMatchesText(capsule, value) === (c.funcName === 'capsuleMatches');
    }
    default:
      return false;
  }
}

/** Every condition matches («… וגם …»), or with `matchAny` at least one («… או …»). No conditions never match. */
export function matchRule(conditions: RuleCondition[], values: Map<string, string>, capsules: CapsuleLookup = NO_CAPSULES, matchAny = false): boolean {
  const hit = (c: RuleCondition) => matchCondition(c, values.get(c.field._id), capsules);
  return conditions.length > 0 && (matchAny ? conditions.some(hit) : conditions.every(hit));
}

/** Capsule ids the rules' conditions refer to. */
export const ruleCapsuleIds = (conditions: RuleCondition[]) =>
  conditions.flatMap((c) => (CAPSULE_FUNCTIONS.includes(c.funcName) && c.content[0] ? [String(c.content[0])] : []));
