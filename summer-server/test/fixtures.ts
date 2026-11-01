import { Harness } from './harness';

/** Ids from the seeded database, looked up by their stable natural keys. */
export async function lookups(h: Harness) {
  const perms = await h.sql<{ id: string; group_name: string }>('select id, group_name from permissions');
  const users = await h.sql<{ id: string; username: string }>('select id, username from users');
  const types = await h.sql<{ id: string; name: string }>('select id, name from content_types');
  const perm = (group: string) => perms.find((p) => p.group_name === group)!.id;
  const user = (username: string) => users.find((u) => u.username === username)!.id;
  const type = (name: string) => types.find((t) => t.name === name)!.id;
  return { perm, user, type };
}

export type Lookups = Awaited<ReturnType<typeof lookups>>;

export const summaryPayload = (l: Lookups, over: Record<string, unknown> = {}) => ({
  title: 'סיכום בדיקה',
  contentHtml: '<p>תוכן הבדיקה</p>',
  notesHtml: '',
  contentType: l.type('generic'),
  department: 'מדעי המחשב',
  labels: [],
  permissions: [l.perm('cs-faculty')],
  taggedUsers: [],
  summaryFields: [],
  files: [],
  isDraft: false,
  ...over,
});

/** POST /summary as multipart (the client's format). */
export async function createSummary(h: Harness, username: string, payload: object): Promise<{ status: number; body: any }> {
  const res = await h.as(username).post('/summary').field('summary', JSON.stringify(payload));
  return { status: res.status, body: res.body };
}
