import { z } from 'zod';

/**
 * Personal preferences (stored as jsonb on the user). Every key is optional: a missing one means the default, so
 * adding a preference needs no migration. Unknown keys are dropped.
 */
export const preferencesSchema = z.object({
  /** Moving to another folder: keep the current search there ('keep', default) or start without one ('reset'). */
  folderSearch: z.enum(['keep', 'reset']).optional(),
  /** Times shown as "3 hours ago" ('relative', default) or as the date and hour ('exact'). */
  dates: z.enum(['relative', 'exact']).optional(),
});

export type UserPreferences = z.output<typeof preferencesSchema>;

/** Stored preferences as the client gets them: a value that no longer validates falls back to the default. */
export function readPreferences(stored: unknown): UserPreferences {
  const out: Record<string, unknown> = {};
  const raw = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  for (const [key, schema] of Object.entries(preferencesSchema.shape)) {
    const r = schema.safeParse(raw[key]);
    if (r.success && r.data !== undefined) out[key] = r.data;
  }
  return out as UserPreferences;
}
