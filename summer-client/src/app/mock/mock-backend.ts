/*
 * Dev-only in-browser backend implementing the spec §7 contract. Loaded lazily by mockApiInterceptor,
 * so none of this ships when mockApi is false. State persists in localStorage (key below) — clear it to reseed.
 */
import { HttpErrorResponse, HttpEvent, HttpParams, HttpRequest, HttpResponse } from '@angular/common/http';
import { Observable, catchError, defer, delay, throwError } from 'rxjs';
import { FolderItemType, ICollection, IComment, IFolder, IFolderItem, INotificationSettings, IPermission, ISummary, ISummarySearch, SearchType, SummaryPayload, SummarySearch, UserRef } from '../shared/models';
import { toHttpParams } from '../shared/services/http-params';
import { DB_VERSION, DbCollection, DbFolder, DbSummary, DbUser, MockDb, seedDb } from './mock-db';

const STORAGE_KEY = 'summer-mock-db';
const LATENCY_MS = 180;

let db: MockDb = load();

function load(): MockDb {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as MockDb | null;
    if (saved?.version === DB_VERSION) return saved;
  } catch {
    /* reseed */
  }
  return seedDb();
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    /* quota — keep in memory */
  }
}

const id = (prefix: string) => `${prefix}${++db.seq}`;
const now = () => new Date().toISOString();

class HttpError {
  constructor(readonly status: number) {}
}

// ---------------- routing ----------------

type Ctx = { req: HttpRequest<unknown>; me: DbUser; params: string[]; q: HttpParams; body: any };
/** May return a value or a Promise (e.g. handlers that lazy-load SheetJS). */
type Handler = (ctx: Ctx) => unknown;
const routes: { method: string; re: RegExp; handler: Handler }[] = [];
const on = (method: string, path: string, handler: Handler) =>
  routes.push({ method, re: new RegExp('^' + path.replace(/:\w+/g, '([^/]*)') + '/?$'), handler });

export function handle(req: HttpRequest<unknown>): Observable<HttpEvent<unknown>> {
  const path = req.url.startsWith('/') ? req.url : `/${req.url}`;
  const token = req.headers.get('authorization')?.replace(/^bearer\s+/i, '').replace(/^"|"$/g, '');
  const me = db.users.find((u) => token === `mock-token-${u._id}`);
  const fail = (status: number) => throwError(() => new HttpErrorResponse({ status, url: req.url, statusText: 'mock' })).pipe(delay(LATENCY_MS));

  if (!me) return fail(401);

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = path.match(r.re);
    if (!m) continue;
    return defer(async () => {
      const body = await r.handler({ req, me, params: m.slice(1).map(decodeURIComponent), q: req.params, body: req.body as any });
      persist();
      return new HttpResponse({ status: 200, body, url: req.url });
    }).pipe(
      delay(LATENCY_MS),
      catchError((e) => {
        if (e instanceof HttpError) return fail(e.status);
        console.error('[mock-backend]', e);
        return fail(500);
      }),
    );
  }
  console.warn('[mock-backend] no route for', req.method, path);
  return fail(404);
}

// ---------------- helpers ----------------

const findUser = (uid: string) => db.users.find((u) => u._id === uid);
const ref = (u: DbUser | undefined): UserRef =>
  u ? { _id: u._id, username: u.username, fullName: u.fullName, department: u.department, isSystem: u.isSystem } : { _id: '', username: '', fullName: 'משתמש לא ידוע' };
const publicUser = ({ favoriteSummaries, email, ...u }: DbUser) => u;
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');

function getSummary(sid: string): DbSummary {
  const s = db.summaries.find((x) => x._id === sid);
  if (!s) throw new HttpError(404);
  return s;
}

function toApi(s: DbSummary, me: DbUser): ISummary {
  return {
    ...s,
    user: ref(findUser(s.user)),
    contentType: db.contentTypes.find((t) => t._id === s.contentType)!,
    labels: s.labels.map((name) => ({ name })),
    comments: s.comments.map((c): IComment => ({ ...c, user: ref(findUser(c.user)) })),
    summaryFields: s.summaryFields.flatMap((f) => {
      const field = db.fields.find((x) => x._id === f.field);
      return field ? [{ _id: f.field, field, value: f.value }] : [];
    }),
    taggedUsers: s.taggedUsers.map((u) => ref(findUser(u))),
    collectionIds: s.collectionIds.flatMap((cid) => {
      const c = db.collections.find((x) => x._id === cid);
      return c ? [{ _id: c._id, name: c.name }] : [];
    }),
    permissions: s.permissions.flatMap((pid) => db.permissions.filter((p) => p._id === pid)),
    isFavorite: me.favoriteSummaries.includes(s._id),
  };
}

function matchesText(s: DbSummary, text: string, types: string[]): boolean {
  const all = !types.length;
  const has = (t: SearchType) => all || types.includes(t);
  const haystack = [
    has(SearchType.Title) ? s.title : '',
    has(SearchType.Content) ? textOf(s.content) : '',
    has(SearchType.Notes) ? textOf(s.notes) : '',
    has(SearchType.Label) ? s.labels.join(' ') : '',
    has(SearchType.Comments) ? s.comments.map((c) => c.content).join(' ') : '',
  ]
    .join(' \n ')
    .toLowerCase();
  const phrases = [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1].toLowerCase());
  const words = text
    .replace(/"[^"]+"/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^#/, '').toLowerCase())
    .filter(Boolean);
  return [...phrases, ...words].every((w) => haystack.includes(w));
}

function inRange(date: string | undefined, range: string[]): boolean {
  if (range.length !== 2 || !date) return range.length !== 2;
  const t = new Date(date).getTime();
  const from = new Date(range[0]);
  from.setHours(0, 0, 0, 0);
  const to = new Date(range[1]);
  to.setHours(23, 59, 59, 999);
  return t >= from.getTime() && t <= to.getTime();
}

function notify(userId: string, text: string, summaryId: string, by: string) {
  if (userId === by) return;
  db.notifications.unshift({ _id: id('n'), userId, text, summaryId, creationDate: now(), isViewed: false, createdBy: by });
}

function payloadToDb(p: SummaryPayload, files: string[], me: DbUser, existing?: DbSummary): DbSummary {
  const eventDate = p.eventDate ? new Date(`${p.eventDate}T${p.eventSecTime ?? '00:00'}:00`).toISOString() : undefined;
  for (const l of p.labels) if (!db.labels.includes(l)) db.labels.push(l);
  return {
    _id: existing?._id ?? id('s'),
    title: p.title,
    content: p.contentHtml,
    notes: p.notesHtml,
    department: p.department,
    user: existing?.user ?? me._id,
    isDraft: p.isDraft,
    creationDate: existing?.creationDate ?? now(),
    modifyDate: now(),
    eventDate,
    eventSecTime: p.eventSecTime ? eventDate : undefined,
    contentType: p.contentType,
    labels: p.labels,
    comments: existing?.comments ?? [],
    summaryFields: p.summaryFields,
    files: [...p.files, ...files],
    taggedUsers: p.taggedUsers,
    collectionIds: p.collectionIds,
    permissions: p.permissions,
    seenBy: existing?.seenBy ?? [me._id],
    color: existing?.color ?? '',
  };
}

function readForm(body: any): { payload: SummaryPayload; files: string[] } {
  if (!(body instanceof FormData)) throw new HttpError(400);
  const payload = JSON.parse(String(body.get('summary'))) as SummaryPayload;
  const files = body.getAll('files').map((f) => (f as File).name);
  return { payload, files };
}

function pinToggle(list: string[], value: string) {
  const i = list.indexOf(value);
  if (i === -1) list.push(value);
  else list.splice(i, 1);
}

// ---------------- summaries ----------------

on('GET', '/api/summary/download', ({ q }) => new Blob([`(mock) contents of ${q.get('fileName')}`], { type: 'text/plain' }));

/** Search-param filter shared by the feed, collection and export endpoints. */
function searchFilter(q: HttpParams) {
  const arr = (k: string) => q.getAll(k) ?? [];
  const text = q.get('text') ?? '';
  return (list: DbSummary[]) =>
    list.filter(
      (s) =>
        (!text || matchesText(s, text, arr('searchTypes'))) &&
        (!arr('contentTypes').length || arr('contentTypes').includes(db.contentTypes.find((t) => t._id === s.contentType)?.name ?? '')) &&
        (!arr('colors').length || arr('colors').includes(s.color)) &&
        (!arr('users').length || arr('users').includes(s.user)) &&
        (!arr('labels').length || arr('labels').some((l) => s.labels.includes(l))) &&
        (!arr('collections').length || arr('collections').some((c) => s.collectionIds.includes(c))) &&
        inRange(s.eventDate, arr('dates')) &&
        inRange(s.creationDate, arr('createdDates')),
    );
}

/** In-place sort by 'field' / '-field'. */
function sortBy(list: DbSummary[], sort: string) {
  const desc = sort.startsWith('-');
  const key = sort.replace('-', '') as keyof DbSummary;
  return list.sort((a, b) => (desc ? -1 : 1) * String(a[key] ?? '').localeCompare(String(b[key] ?? ''), 'he'));
}

const visibleTo = (me: DbUser) => db.summaries.filter((s) => !s.isDraft || s.user === me._id);
const page = (q: HttpParams) => ({ skip: Number(q.get('skip') ?? 0), limit: Number(q.get('limit') ?? 20) });

on('GET', '/api/summary/user/:userId', ({ me, params: [ownerId], q }) => {
  const isProfile = q.get('isProfile') === 'true';
  const bucket = (q.get('summarySearch') as SummarySearch) ?? SummarySearch.Summary;
  const owner = findUser(ownerId);
  if (!owner) throw new HttpError(404);

  const visible = visibleTo(me);
  const scope = (b: SummarySearch) => {
    if (!isProfile) return b === SummarySearch.Draft ? visible.filter((s) => s.isDraft && s.user === me._id) : visible.filter((s) => !s.isDraft);
    switch (b) {
      case SummarySearch.Draft:
        return visible.filter((s) => s.isDraft && s.user === owner._id);
      case SummarySearch.Tagged:
        return visible.filter((s) => !s.isDraft && s.taggedUsers.includes(owner._id));
      case SummarySearch.Favorite:
        return visible.filter((s) => owner.favoriteSummaries.includes(s._id));
      default:
        return visible.filter((s) => !s.isDraft && s.user === owner._id);
    }
  };
  const filter = searchFilter(q);
  const list = sortBy(filter(scope(bucket)), q.get('sort') ?? '-eventDate');
  const { skip, limit } = page(q);

  return {
    summaries: list.slice(skip, skip + limit).map((s) => toApi(s, me)),
    lengths: {
      summary: filter(scope(SummarySearch.Summary)).length,
      draft: filter(scope(SummarySearch.Draft)).length,
      tagged: filter(scope(SummarySearch.Tagged)).length,
      favorite: filter(scope(SummarySearch.Favorite)).length,
    },
  };
});

/** Dashboard: published summaries grouped by their first label (the course). */
on('GET', '/api/summary/user/:userId/dashboard', ({ me }) => {
  const groups: Record<string, ISummary[]> = {};
  for (const s of sortBy(visibleTo(me).filter((x) => !x.isDraft), '-eventDate')) {
    const group = (groups[s.labels[0] ?? 'ללא תגית'] ??= []);
    if (group.length < 8) group.push(toApi(s, me));
  }
  return groups;
});

on('GET', '/api/summary/:id/:isMine', ({ me, params: [sid] }) => {
  const s = getSummary(sid);
  if (s.isDraft && s.user !== me._id) throw new HttpError(403);
  if (!s.seenBy.includes(me._id)) s.seenBy.push(me._id);
  return toApi(s, me);
});

on('POST', '/api/summary', ({ me, body }) => {
  const { payload, files } = readForm(body);
  const s = payloadToDb(payload, files, me);
  db.summaries.unshift(s);
  for (const u of s.taggedUsers) notify(u, `${me.fullName} תייג/ה אותך בסיכום "${s.title}"`, s._id, me._id);
  return toApi(s, me);
});

on('PUT', '/api/summary', ({ me, body }) => {
  const { payload, files } = readForm(body);
  const existing = getSummary(payload.id!);
  if (existing.user !== me._id) throw new HttpError(403);
  const s = payloadToDb(payload, files, me, existing);
  db.summaries[db.summaries.indexOf(existing)] = s;
  for (const u of s.taggedUsers.filter((u) => !existing.taggedUsers.includes(u))) notify(u, `${me.fullName} תייג/ה אותך בסיכום "${s.title}"`, s._id, me._id);
  return toApi(s, me);
});

on('DELETE', '/api/summary', ({ me, body }) => {
  const s = getSummary(body?.id);
  if (s.user !== me._id) throw new HttpError(403);
  db.summaries = db.summaries.filter((x) => x._id !== s._id);
  return {};
});

on('PUT', '/api/summary/color', ({ body }) => {
  getSummary(body.id ?? body.summaryId).color = body.color ?? '';
  return {};
});

on('PUT', '/api/summary/to-draft', ({ me, body }) => {
  const s = getSummary(body.id);
  if (s.user !== me._id) throw new HttpError(403);
  s.isDraft = true;
  return {};
});

on('PUT', '/api/summary/updateTimelineTitle', ({ body }) => {
  getSummary(body.id ?? body.summaryId).timelineTitle = body.timelineTitle;
  return {};
});

// ---------------- comments ----------------

on('PUT', '/api/comment', ({ me, body }) => {
  const s = getSummary(body.summaryId);
  const comment = { _id: id('cm'), content: String(body.content ?? ''), mentions: body.mentions ?? [], user: me._id, creationDate: now() };
  s.comments.push(comment);
  if (s.user !== me._id) notify(s.user, `${me.fullName} הגיב/ה על הסיכום "${s.title}"`, s._id, me._id);
  for (const m of comment.mentions.filter((m: { type: string }) => m.type === 'user')) notify(m._id, `${me.fullName} הזכיר/ה אותך בתגובה`, s._id, me._id);
  return { ...comment, user: ref(me) };
});

on('DELETE', '/api/comment/:commentId', ({ me, params: [cid], body }) => {
  const s = getSummary(body?.summaryId);
  const c = s.comments.find((x) => x._id === cid);
  if (!c) throw new HttpError(404);
  if (c.user !== me._id) throw new HttpError(403);
  s.comments = s.comments.filter((x) => x._id !== cid);
  return {};
});

// ---------------- catalogs ----------------

on('GET', '/api/content-type', () => db.contentTypes);
on('GET', '/api/field', () => db.fields);
on('GET', '/api/field/summaries', ({ me, q }) =>
  db.summaries
    .filter((s) => (!s.isDraft || s.user === me._id) && s.summaryFields.some((f) => f.field === q.get('fieldId') && f.value === q.get('value')))
    .map((s) => ({ _id: s._id, title: s.title })),
);
on('GET', '/api/labels', ({ q }) => {
  const text = (q.get('text') ?? '').toLowerCase();
  const skip = Number(q.get('skip') ?? 0);
  return db.labels.filter((l) => l.toLowerCase().includes(text)).slice(skip, skip + 20);
});
on('GET', '/api/permissions', () => db.permissions);
on('GET', '/api/permissions/user', ({ me }) => db.permissions.filter((p) => me.permissions.includes(p._id)));
// Dashboard is open to academic staff (p5).
on('GET', '/api/permissions/dashboard', () => db.permissions.filter((p) => p._id === 'p5'));
on('GET', '/api/permissions/permitted', ({ me }) => canManagePermissions(me));

on('GET', '/api/collection/collectionName/:text', ({ params: [text] }) =>
  db.collections.filter((c) => c.name.includes(text ?? '')).map((c) => ({ _id: c._id, name: c.name })),
);
on('GET', '/api/collection/ids', ({ q }) => {
  const ids = (q.get('_ids') ?? '').split(',');
  return db.collections.filter((c) => ids.includes(c._id)).map((c) => ({ _id: c._id, name: c.name }));
});

// ---------------- users ----------------

on('GET', '/api/user', ({ me }) => publicUser(me));
on('GET', '/api/user/ids', ({ q }) => {
  const ids = (q.get('_ids') ?? '').split(',');
  return db.users.filter((u) => ids.includes(u._id)).map(ref);
});
on('GET', '/api/user/query/:prefix', ({ params: [prefix] }) =>
  db.users.filter((u) => !u.isSystem && (u.username.startsWith(prefix.toLowerCase()) || u.fullName.includes(prefix))).map(ref),
);
on('GET', '/api/user/name/:text', ({ params: [text] }) => db.users.filter((u) => !u.isSystem && u.fullName.includes(text)).map(ref));
on('GET', '/api/user/pinned-search', ({ me }) => publicUser(me));
on('POST', '/api/user/pinned-search', ({ me, body }) => {
  const { isPin, ...search } = body as ISummarySearch;
  const key = (s: ISummarySearch) => JSON.stringify(Object.entries(s).filter(([k]) => k !== 'sort' && k !== 'isPin').sort());
  me.pinnedSearches = me.pinnedSearches.filter((s) => key(s) !== key(search));
  if (isPin) me.pinnedSearches.unshift(search);
  return publicUser(me);
});
on('POST', '/api/user/pinned-label', ({ me, body }) => (pinToggle(me.pinnedLabels, body.label), publicUser(me)));
on('POST', '/api/user/pinned-permission', ({ me, body }) => (pinToggle(me.pinnedPermissions, body.permissionId), publicUser(me)));
on('POST', '/api/user/pinned-collection', ({ me, body }) => (pinToggle(me.pinnedCollections, body.collectionId), publicUser(me)));
on('POST', '/api/user/favorite-label', ({ me, body }) => (pinToggle(me.favoriteLabels, body.valueId), publicUser(me)));
on('POST', '/api/user/favorite-collection', ({ me, body }) => (pinToggle(me.favoriteCollections, body.valueId), publicUser(me)));
on('POST', '/api/user/favorite-permission', ({ me }) => publicUser(me));
on('PUT', '/api/user/favorite', ({ me, body }) => (pinToggle(me.favoriteSummaries, body.summaryId), publicUser(me)));
on('PUT', '/api/user/add-follow/:userId', ({ me, params: [uid] }) => {
  if (!me.following.includes(uid)) me.following.push(uid);
  return publicUser(me);
});
on('DELETE', '/api/user/remove-follow/:userId', ({ me, params: [uid] }) => {
  me.following = me.following.filter((f) => f !== uid);
  return publicUser(me);
});
on('GET', '/api/user/:username', ({ params: [username] }) => {
  const u = db.users.find((x) => x.username === username);
  if (!u) throw new HttpError(404);
  return ref(u);
});

// ---------------- notifications ----------------

on('GET', '/api/notifications', ({ me }) =>
  db.notifications
    .filter((n) => n.userId === me._id)
    .map(({ userId, createdBy, ...n }) => ({ ...n, createdBy: createdBy ? ref(findUser(createdBy)) : undefined })),
);
on('PUT', '/api/notifications/all-viewed', ({ me }) => {
  for (const n of db.notifications) if (n.userId === me._id) n.isViewed = true;
  return {};
});
on('PUT', '/api/notifications/viewed/:notificationId', ({ me, params: [nid] }) => {
  const n = db.notifications.find((x) => x._id === nid && x.userId === me._id);
  if (n) n.isViewed = true;
  return {};
});

// ---------------- excel ----------------

/** Endpoints are called with responseType 'arraybuffer', so answer with an ArrayBuffer (HttpClient rejects a Blob). */
async function workbook(rows: unknown[][]): Promise<ArrayBuffer> {
  const XLSX = await import('xlsx');
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!views'] = [{ RTL: true }];
  XLSX.utils.book_append_sheet(book, sheet, 'Summer');
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

on('POST', '/api/summary/download/template', ({ body }) => workbook([body.fieldNames ?? []]));

on('POST', '/api/summary/download/excel', ({ me, body }) => {
  const ids: string[] = body.summariesId ?? [];
  const list = body.all
    ? sortBy(searchFilter(toHttpParams(body.search ?? {}))(visibleTo(me).filter((s) => !s.isDraft)), body.search?.sort ?? '-eventDate')
    : visibleTo(me).filter((s) => ids.includes(s._id));
  return workbook([
    ['כותרת', 'מחבר', 'סוג', 'תאריך האירוע', 'תגיות', 'תוכן'],
    ...list.map((s) => [
      s.title,
      findUser(s.user)?.fullName ?? '',
      db.contentTypes.find((t) => t._id === s.contentType)?.displayName ?? '',
      s.eventDate ? new Date(s.eventDate).toLocaleDateString('he-IL') : '',
      s.labels.join(', '),
      textOf(s.content).replace(/\s+/g, ' ').trim(),
    ]),
  ]);
});

on('POST', '/api/summary/upload/excel', async ({ me, body }) => {
  if (!(body instanceof FormData)) throw new HttpError(400);
  const XLSX = await import('xlsx');
  const file = body.get('file') as File;
  const headersMap = JSON.parse(String(body.get('headersMap') ?? '{}')) as Record<string, string>;
  const book = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[book.SheetNames[0]], { defval: '' });
  const str = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? '').trim());
  let created = 0;
  for (const row of rows) {
    const values: Record<string, string> = {};
    for (const [header, key] of Object.entries(headersMap)) values[key] = str(row[header]);
    if (!values['title']) continue;
    const labels = (values['labels'] ?? '')
      .split(/[,،]/)
      .map((l) => l.trim())
      .filter(Boolean);
    for (const l of labels) if (!db.labels.includes(l)) db.labels.push(l);
    const eventDate = values['eventDate'] ? new Date(values['eventDate']) : null;
    db.summaries.unshift({
      _id: id('s'),
      title: values['title'],
      content: values['content'] ? `<p>${values['content']}</p>` : '',
      notes: values['notes'] ? `<p>${values['notes']}</p>` : '',
      department: values['department'] || me.department,
      user: me._id,
      isDraft: false,
      creationDate: now(),
      modifyDate: now(),
      eventDate: eventDate && !isNaN(eventDate.getTime()) ? eventDate.toISOString() : undefined,
      contentType: String(body.get('type')),
      labels,
      comments: [],
      summaryFields: Object.entries(values)
        .filter(([k, v]) => v && db.fields.some((f) => f._id === k))
        .map(([field, value]) => ({ field, value })),
      files: [],
      taggedUsers: [],
      collectionIds: body.getAll('collections').map(String),
      permissions: body.getAll('permissions').map(String),
      seenBy: [me._id],
      color: '',
    });
    created++;
  }
  return { created };
});

// ---------------- collections ----------------

function toCollection(c: DbCollection): ICollection {
  return {
    _id: c._id,
    name: c.name,
    permissions: c.permissions.flatMap((pid) => db.permissions.filter((p) => p._id === pid)),
    summaries: db.summaries.filter((s) => !s.isDraft && s.collectionIds.includes(c._id)).map((s) => s._id),
    managers: c.managers,
    createdBy: ref(findUser(c.createdBy)),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    isDeleted: false,
  };
}

function getCollection(cid: string): DbCollection {
  const c = db.collections.find((x) => x._id === cid);
  if (!c) throw new HttpError(404);
  return c;
}

function assertManager(c: DbCollection, me: DbUser) {
  if (!c.managers.includes(me._id)) throw new HttpError(403);
}

on('GET', '/api/collection/user/:userId', ({ me, q }) => {
  const text = q.get('text') ?? '';
  const skip = Number(q.get('skip') ?? 0);
  const all = q.get('all') !== 'false';
  const rank = (c: DbCollection) => (me.pinnedCollections.includes(c._id) ? 0 : me.favoriteCollections.includes(c._id) ? 1 : 2);
  const prioritized = q.get('getPrioritized') === 'true';
  const list = db.collections
    .filter((c) => c.name.includes(text) && (all || c.managers.includes(me._id)))
    .sort((a, b) => (prioritized ? rank(a) - rank(b) : 0) || b.updatedAt.localeCompare(a.updatedAt));
  return list.slice(skip, skip + 20).map(toCollection);
});

on('GET', '/api/collection/summaries/:collectionId', ({ me, params: [cid], q }) => {
  getCollection(cid);
  const inCollection = visibleTo(me).filter((s) => !s.isDraft && s.collectionIds.includes(cid));
  const list = sortBy(searchFilter(q)(inCollection), q.get('sort') ?? '-eventDate');
  const { skip, limit } = page(q);
  return { summaries: list.slice(skip, skip + limit).map((s) => toApi(s, me)), lengths: { summary: list.length, draft: 0, tagged: 0, favorite: 0 } };
});

on('POST', '/api/collection/create', ({ me, body }) => {
  const c: DbCollection = {
    _id: id('c'),
    name: String(body.name ?? '').trim(),
    permissions: body.permissions ?? [],
    managers: body.managers?.length ? body.managers : [me._id],
    createdBy: me._id,
    createdAt: now(),
    updatedAt: now(),
  };
  if (!c.name) throw new HttpError(400);
  db.collections.unshift(c);
  return toCollection(c);
});

on('POST', '/api/collection/edit/:collectionId', ({ me, params: [cid], body }) => {
  const c = getCollection(cid);
  assertManager(c, me);
  c.name = String(body.name ?? c.name).trim() || c.name;
  c.permissions = body.permissions ?? c.permissions;
  c.managers = body.managers?.length ? body.managers : c.managers;
  c.updatedAt = now();
  const remove: string[] = body.summaries ?? [];
  for (const s of db.summaries) if (remove.includes(s._id)) s.collectionIds = s.collectionIds.filter((x) => x !== cid);
  return toCollection(c);
});

on('POST', '/api/collection/add', ({ body }) => {
  const cids: string[] = body.collectionIds ?? [];
  const sids: string[] = body.summaryIds ?? [];
  for (const cid of cids) getCollection(cid).updatedAt = now();
  for (const s of db.summaries) if (sids.includes(s._id)) s.collectionIds = [...new Set([...s.collectionIds, ...cids])];
  return {};
});

on('DELETE', '/api/collection/:id', ({ me, params: [cid] }) => {
  const c = getCollection(cid);
  assertManager(c, me);
  db.collections = db.collections.filter((x) => x._id !== cid);
  for (const s of db.summaries) s.collectionIds = s.collectionIds.filter((x) => x !== cid);
  return {};
});

on('GET', '/api/collection/:id', ({ params: [cid] }) => toCollection(getCollection(cid)));

// ---------------- hierarchy (folders) ----------------

function folderItems(fid: string, me: DbUser): IFolderItem[] {
  const collections = db.collections.filter((c) => c.folderId === fid).map((c): IFolderItem => ({ type: 'collection', _id: c._id, name: c.name }));
  const summaries = visibleTo(me)
    .filter((s) => !s.isDraft && s.folderId === fid)
    .map((s): IFolderItem => ({ type: 'summary', _id: s._id, name: s.title }));
  return [...collections, ...summaries];
}

function toFolder(f: DbFolder, me: DbUser): IFolder {
  return {
    _id: f._id,
    name: f.name,
    parentId: f.parentId,
    itemCount: folderItems(f._id, me).length,
    permissions: f.permissions.flatMap((pid) => db.permissions.filter((p) => p._id === pid)),
    managers: f.managers,
    createdBy: ref(findUser(f.createdBy)),
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}

function getFolder(fid: string): DbFolder {
  const f = db.folders.find((x) => x._id === fid);
  if (!f) throw new HttpError(404);
  return f;
}

/** Open to everyone when it has no permission groups; managers always see their folders. */
const canSeeFolder = (f: DbFolder, me: DbUser) => !f.permissions.length || f.managers.includes(me._id) || f.permissions.some((p) => me.permissions.includes(p));

/** A folder is visible only if it and every ancestor are visible. */
function visibleFolders(me: DbUser): DbFolder[] {
  const byId = new Map(db.folders.map((f) => [f._id, f]));
  const ok = (f: DbFolder | undefined): boolean => !!f && canSeeFolder(f, me) && (f.parentId === null || ok(byId.get(f.parentId)));
  return db.folders.filter((f) => ok(f));
}

function assertFolderManager(f: DbFolder, me: DbUser) {
  if (!f.managers.includes(me._id)) throw new HttpError(403);
}

function subtreeIds(fid: string): string[] {
  const children = db.folders.filter((f) => f.parentId === fid).map((f) => f._id);
  return [fid, ...children.flatMap(subtreeIds)];
}

const itemsOf = (body: any): { type: FolderItemType; _id: string }[] => (Array.isArray(body?.items) ? body.items : []);

on('GET', '/api/folder', ({ me }) => visibleFolders(me).map((f) => toFolder(f, me)));

on('GET', '/api/folder/:id/items', ({ me, params: [fid] }) => {
  if (!visibleFolders(me).some((f) => f._id === fid)) throw new HttpError(404);
  return folderItems(fid, me);
});

on('POST', '/api/folder/create', ({ me, body }) => {
  const parentId: string | null = body.parentId ?? null;
  // Anyone may create a root folder; subfolders need a manager of the parent.
  if (parentId) assertFolderManager(getFolder(parentId), me);
  const f: DbFolder = {
    _id: id('fd'),
    name: String(body.name ?? '').trim(),
    parentId,
    permissions: body.permissions ?? [],
    managers: body.managers?.length ? body.managers : [me._id],
    createdBy: me._id,
    createdAt: now(),
    updatedAt: now(),
  };
  if (!f.name) throw new HttpError(400);
  db.folders.push(f);
  return toFolder(f, me);
});

on('POST', '/api/folder/edit/:id', ({ me, params: [fid], body }) => {
  const f = getFolder(fid);
  assertFolderManager(f, me);
  f.name = String(body.name ?? f.name).trim() || f.name;
  f.permissions = body.permissions ?? f.permissions;
  f.managers = body.managers?.length ? body.managers : f.managers;
  f.updatedAt = now();
  return toFolder(f, me);
});

on('POST', '/api/folder/:id/items/remove', ({ me, params: [fid], body }) => {
  assertFolderManager(getFolder(fid), me);
  const ids = new Set(itemsOf(body).map((i) => i._id));
  for (const c of db.collections) if (c.folderId === fid && ids.has(c._id)) delete c.folderId;
  for (const s of db.summaries) if (s.folderId === fid && ids.has(s._id)) delete s.folderId;
  return {};
});

on('POST', '/api/folder/:id/items', ({ me, params: [fid], body }) => {
  const f = getFolder(fid);
  assertFolderManager(f, me);
  for (const item of itemsOf(body)) {
    const target = item.type === 'collection' ? db.collections.find((c) => c._id === item._id) : db.summaries.find((s) => s._id === item._id && !s.isDraft);
    if (target) target.folderId = fid;
  }
  f.updatedAt = now();
  return {};
});

on('DELETE', '/api/folder/:id', ({ me, params: [fid] }) => {
  assertFolderManager(getFolder(fid), me);
  const ids = new Set(subtreeIds(fid));
  db.folders = db.folders.filter((f) => !ids.has(f._id));
  for (const c of db.collections) if (c.folderId && ids.has(c.folderId)) delete c.folderId;
  for (const s of db.summaries) if (s.folderId && ids.has(s.folderId)) delete s.folderId;
  return {};
});

// ---------------- permissions admin ----------------

const canManagePermissions = (me: DbUser) => me.permissions.includes('p5');

on('PUT', '/api/permissions', ({ me, body }) => {
  if (!canManagePermissions(me)) throw new HttpError(403);
  const p = body as IPermission;
  const existing = db.permissions.find((x) => x._id === p._id);
  if (existing) {
    Object.assign(existing, { name: p.name, groupName: p.groupName, color: p.color });
    return existing;
  }
  const created: IPermission = { _id: id('p'), name: p.name, groupName: p.groupName, color: p.color };
  db.permissions.push(created);
  return created;
});

on('DELETE', '/api/permissions/:id', ({ me, params: [pid] }) => {
  if (!canManagePermissions(me)) throw new HttpError(403);
  db.permissions = db.permissions.filter((p) => p._id !== pid);
  for (const s of db.summaries) s.permissions = s.permissions.filter((x) => x !== pid);
  for (const c of db.collections) c.permissions = c.permissions.filter((x) => x !== pid);
  for (const f of db.folders) f.permissions = f.permissions.filter((x) => x !== pid);
  return {};
});

// ---------------- notification rules ----------------

on('GET', '/api/notifications/settings', () => db.notificationSettings);

on('POST', '/api/notifications', ({ body }) => {
  const rule: INotificationSettings = { ...(body as INotificationSettings), _id: id('ns'), creationDate: now() };
  db.notificationSettings.unshift(rule);
  return rule;
});

on('PUT', '/api/notifications', ({ body }) => {
  const i = db.notificationSettings.findIndex((r) => r._id === body._id);
  if (i === -1) throw new HttpError(404);
  db.notificationSettings[i] = { ...db.notificationSettings[i], ...(body as INotificationSettings) };
  return db.notificationSettings[i];
});

on('DELETE', '/api/notifications/:notificationId', ({ params: [rid] }) => {
  db.notificationSettings = db.notificationSettings.filter((r) => r._id !== rid);
  return {};
});

// ---------------- what's new ----------------

const RELEASES = [{ version: '2.0.0', date: '2026-10-23' }];

on('GET', '/api/whats-new', ({ me }) => RELEASES.map((r) => ({ ...r, isAcknowledged: me.acknowledged.includes(r.version) })));

on('POST', '/api/whats-new/acknowledge', ({ me, body }) => {
  if (!me.acknowledged.includes(body.version)) me.acknowledged.push(body.version);
  return {};
});
