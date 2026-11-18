import { z } from 'zod';

// ---------------------------------------------------------------- input primitives

export const id = z.string().uuid();
export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use yyyy-MM-dd');
export const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use HH:mm');

// ---------------------------------------------------------------- output shapes (tools' outputSchema / structuredContent)

const kind = z.enum(['summary', 'running', 'sumaroon']);
const ref = z.object({ id: z.string(), name: z.string() });
const titled = z.object({ id: z.string(), title: z.string() });
const range = z.object({ from: z.string().optional(), to: z.string().optional() });

/** A search hit: enough to pick which ones to open. */
export const summaryBrief = z.object({
  id: z.string(),
  title: z.string(),
  kind,
  isDraft: z.boolean().optional(),
  eventDate: z.string().optional().describe('yyyy-MM-dd, or yyyy-MM-dd HH:mm when it has a time.'),
  created: z.string(),
  author: ref.optional(),
  department: z.string().optional(),
  contentType: z.string().optional(),
  labels: z.array(z.string()),
  runningSummary: titled.optional(),
  range: range.optional(),
  sumaroonCount: z.number().optional(),
  snippet: z.string(),
});
export type SummaryBrief = z.infer<typeof summaryBrief>;

/** One summary in full, rich text as plain text. */
export const summaryFull = z.object({
  id: z.string(),
  title: z.string(),
  kind,
  isDraft: z.boolean(),
  eventDate: z.string().optional(),
  eventTime: z.string().optional(),
  created: z.string(),
  modified: z.string(),
  author: ref.extend({ username: z.string() }),
  department: z.string().optional(),
  contentType: ref.extend({ displayName: z.string() }),
  content: z.string(),
  notes: z.string().optional(),
  labels: z.array(z.string()),
  fields: z.array(z.object({ fieldId: z.string(), name: z.string(), value: z.string() })),
  permissions: z.array(ref),
  taggedUsers: z.array(ref),
  taggedPermissions: z.array(ref),
  folders: z.array(ref),
  files: z.array(z.string()),
  link: z.string().optional(),
  runningSummary: titled.extend({ range }).optional(),
  range: range.optional(),
  sumaroonCount: z.number().optional(),
  canEdit: z.boolean(),
  comments: z.array(z.object({ id: z.string(), author: z.string().optional(), date: z.string(), content: z.string() })),
});
export type SummaryFull = z.infer<typeof summaryFull>;

/** One page of search results. */
export const searchPage = {
  total: z.number(),
  offset: z.number(),
  returned: z.number(),
  more: z.boolean(),
  items: z.array(summaryBrief),
};

export const user = z.object({ id: z.string(), name: z.string(), username: z.string(), department: z.string().optional() });
export const permissionGroup = z.object({ id: z.string(), name: z.string(), group: z.string().optional() });

export const query = z.object({
  id: z.string(),
  name: z.string(),
  owner: z.string().describe('"me", or the owner\'s name.'),
  isShared: z.boolean(),
  isFavorite: z.boolean().optional(),
  followers: z.number(),
  search: z.record(z.string(), z.unknown()),
  alert: z.object({ active: z.boolean(), mail: z.boolean(), digest: z.boolean() }).nullable(),
  updated: z.string(),
});
export type QueryOut = z.infer<typeof query>;

export const bulkResult = {
  applied: z.array(z.string()).describe('Summaries that changed.'),
  skipped: z.array(z.object({ id: z.string(), reason: z.string() })),
};

export const saveStatus = z.enum(['draft', 'published']);
