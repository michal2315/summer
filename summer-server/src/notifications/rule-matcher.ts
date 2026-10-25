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
] as const;

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

/** One condition against a summary's value for that field. A missing value never matches. */
export function matchCondition(c: RuleCondition, value: string | undefined): boolean {
  if (value === undefined || value === '') return false;
  const [a, b] = c.content;
  switch (c.funcName) {
    case 'stringContains':
      return a !== null && a !== undefined && value.toLowerCase().includes(String(a).toLowerCase());
    case 'stringNotContains':
      return a !== null && a !== undefined && !value.toLowerCase().includes(String(a).toLowerCase());
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
    default:
      return false;
  }
}

/** A rule matches when every condition matches (AND), like the client's rule description «… וגם …». */
export function matchRule(conditions: RuleCondition[], values: Map<string, string>): boolean {
  return conditions.length > 0 && conditions.every((c) => matchCondition(c, values.get(c.field._id)));
}
