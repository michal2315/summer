import { BadRequestException, Injectable, NotFoundException, PipeTransform } from '@nestjs/common';
import { z } from 'zod';

/** Parse with a zod schema; invalid input becomes a 400 listing the offending paths. */
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException({
      message: 'Validation failed',
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** Route ids: anything that is not a UUID cannot exist, so answer 404 (same as a missing or hidden row). */
@Injectable()
export class IdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!isUuid(value)) throw new NotFoundException();
    return value.toLowerCase();
  }
}

export const zId = z.string().regex(UUID_RE, 'must be an id').transform((s) => s.toLowerCase());

/** Query-string list: absent → [], `a` → ['a'], `a&a` → ['a','a']; also accepts comma-joined values. */
export const zList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? [] : (Array.isArray(v) ? v : [v]).flatMap((x) => x.split(',')).map((x) => x.trim()).filter(Boolean)));

export const zBoolString = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .optional()
  .transform((v) => v === true || v === 'true');

export const unique = <T>(xs: T[]): T[] => [...new Set(xs)];
