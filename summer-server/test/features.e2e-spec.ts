import { Harness, createHarness } from './harness';
import { Lookups, createSummary, lookups, summaryPayload } from './fixtures';

describe('summaries, comments, personal state', () => {
  let h: Harness;
  let l: Lookups;

  beforeAll(async () => {
    h = await createHarness();
    l = await lookups(h);
  });
  afterAll(() => h.close());

  const myId = async (username: string) => (await h.as(username).get('/user')).body._id as string;
  const search = async (username: string, query: string) => (await h.as(username).get(`/summary/user/${await myId(username)}?${query}`)).body;

  it('returns the client ISummary shape', async () => {
    const { status, body } = await createSummary(
      h,
      'mgolan',
      summaryPayload(l, {
        contentType: l.type('lecture'),
        labels: ['תווית א', 'תווית ב'],
        eventDate: '2026-03-15',
        eventSecTime: '09:30',
        summaryFields: [{ field: (await h.sql<{ id: string }>(`select id from fields where name = 'שם הקורס'`))[0].id, value: 'קורס' }],
      }),
    );
    expect(status).toBe(201);
    expect(body).toMatchObject({
      title: 'סיכום בדיקה',
      content: '<p>תוכן הבדיקה</p>',
      isDraft: false,
      user: { username: 'mgolan' },
      contentType: { name: 'lecture' },
      labels: [{ name: 'תווית א' }, { name: 'תווית ב' }],
      summaryFields: [{ value: 'קורס', field: { name: 'שם הקורס', type: 'string' } }],
      permissions: [{ groupName: 'cs-faculty' }],
      isFavorite: false,
      comments: [],
      files: [],
    });
    // 09:30 Asia/Jerusalem (UTC+2 in March) → 07:30Z
    expect(body.eventDate).toBe('2026-03-15T07:30:00.000Z');
    expect(body.eventSecTime).toBe(body.eventDate);
  });

  it('requires the content type’s required fields when publishing', async () => {
    expect((await createSummary(h, 'mgolan', summaryPayload(l, { contentType: l.type('lecture') }))).status).toBe(400);
  });

  it('sanitizes Quill HTML (scripts, handlers, javascript: links)', async () => {
    const { body } = await createSummary(
      h,
      'mgolan',
      summaryPayload(l, { contentHtml: '<p class="ql-align-right" onclick="x()">שלום<script>alert(1)</script> <a href="javascript:alert(1)">x</a> <a href="https://e.edu">y</a></p>' }),
    );
    expect(body.content).not.toMatch(/script|onclick|javascript:/);
    expect(body.content).toContain('class="ql-align-right"');
    expect(body.content).toContain('href="https://e.edu"');
  });

  it('searches words, phrases and substrings inside words, in Hebrew and English', async () => {
    await createSummary(h, 'mgolan', summaryPayload(l, { title: 'Dijkstra אלגוריתמיקה', contentHtml: '<p>shortest paths ומסלולים קלים</p>' }));
    expect((await search('mgolan', 'text=jkst')).lengths.summary).toBe(1); // inside an English word
    expect((await search('mgolan', `text=${encodeURIComponent('גוריתמיק')}`)).lengths.summary).toBeGreaterThanOrEqual(1); // inside a Hebrew word
    expect((await search('mgolan', `text=${encodeURIComponent('"shortest paths"')}`)).lengths.summary).toBe(1);
    expect((await search('mgolan', `text=${encodeURIComponent('"paths shortest"')}`)).lengths.summary).toBe(0);
    expect((await search('mgolan', `text=${encodeURIComponent('Dijkstra קלים')}`)).lengths.summary).toBe(1); // AND across fields
    expect((await search('mgolan', 'text=jkst&searchTypes=CONTENT')).lengths.summary).toBe(0); // restricted to content
  });

  it('searches with and / or / not, @user and :content-type in the text', async () => {
    const courseField = (await h.sql<{ id: string }>(`select id from fields where name = 'שם הקורס'`))[0].id;
    await createSummary(h, 'mgolan', summaryPayload(l, { title: 'זברה ג׳ירפה' }));
    await createSummary(
      h,
      'dlevi',
      summaryPayload(l, { title: 'זברה פיל', contentType: l.type('lecture'), summaryFields: [{ field: courseField, value: 'קורס' }] }),
    );
    const count = async (text: string) => (await search('mgolan', `text=${encodeURIComponent(text)}`)).lengths.summary;
    expect(await count('ג׳ירפה או פיל')).toBe(2);
    expect(await count('ג׳ירפה and פיל')).toBe(0);
    expect(await count('זברה not פיל')).toBe(1);
    expect(await count('זברה @DLevi')).toBe(1);
    expect(await count('זברה @nobody')).toBe(0);
    expect(await count('זברה :lecture')).toBe(1);
    expect(await count('זברה :כללי')).toBe(1);
  });

  it('advanced search: nested and / or groups over fields, values and dates, plus a live count', async () => {
    const courseField = (await h.sql<{ id: string }>(`select id from fields where name = 'שם הקורס'`))[0].id;
    const { body: a } = await createSummary(h, 'mgolan', summaryPayload(l, { title: 'קנגורו א', contentHtml: '<p>שפן</p>', eventDate: '2026-02-10' }));
    await createSummary(
      h,
      'dlevi',
      summaryPayload(l, { title: 'קנגורו ב', contentType: l.type('lecture'), summaryFields: [{ field: courseField, value: 'קורס' }], eventDate: '2026-05-10' }),
    );
    // a sits in מדעי המחשב, a subfolder of סמסטר א׳: filtering by a folder includes its subfolders.
    const [semester] = await h.sql<{ id: string }>(`select id from folders where name = 'סמסטר א׳'`);
    const [cs] = await h.sql<{ id: string }>(`select id from folders where name = 'מדעי המחשב'`);
    await h.as('mgolan').post(`/folder/${cs.id}/items`).send({ summaryIds: [a._id] }).expect(201);
    const dlevi = await myId('dlevi');

    const cond = (field: string, op: string, more: object) => ({ type: 'cond', field, op, ...more });
    const group = (op: 'AND' | 'OR', ...children: object[]) => ({ type: 'group', op, children });
    const run = async (query: object, text = 'קנגורו') =>
      (await h.as('mgolan').get('/summary/count').query({ text, query: JSON.stringify(query) }).expect(200)).body.count;

    expect(await run(group('AND'))).toBe(2); // empty tree = no filter
    expect(await run(group('AND', cond('content', 'all', { words: ['שפן'] })))).toBe(1);
    expect(await run(group('AND', cond('title', 'none', { words: ['א'] })))).toBe(1);
    expect(await run(group('AND', cond('author', 'isNot', { values: [dlevi] })))).toBe(1);
    expect(await run(group('AND', cond('contentType', 'isOneOf', { values: ['lecture'] })))).toBe(1);
    expect(await run(group('AND', cond('folder', 'isOneOf', { values: [semester.id] })))).toBe(1);
    expect(await run(group('AND', cond('folder', 'isNot', { values: [cs.id] })))).toBe(1);
    expect(await run(group('AND', cond('eventDate', 'after', { from: '2026-04-01T00:00:00.000Z' })))).toBe(1);
    // (content has שפן OR author is dlevi) AND event date before March → only a
    expect(
      await run(
        group(
          'AND',
          group('OR', cond('content', 'any', { words: ['שפן'] }), cond('author', 'isOneOf', { values: [dlevi] })),
          cond('eventDate', 'before', { to: '2026-03-01T00:00:00.000Z' }),
        ),
      ),
    ).toBe(1);

    await h.as('mgolan').get('/summary/count').query({ query: '{not json' }).expect(400);
    await h.as('mgolan').get('/summary/count').query({ query: JSON.stringify(group('AND', cond('author', 'after', { values: [] }))) }).expect(400);
    await h.as('mgolan').get('/summary/count').query({ query: JSON.stringify(group('AND', cond('author', 'isOneOf', { values: ['x'] }))) }).expect(400);
  });

  it('keeps a summary in a folder the editor cannot see when they save it', async () => {
    // A staff-only folder (dlevi cannot see it) holding dlevi's summary.
    const [staff] = await h.sql<{ id: string }>(`select id from folders where name = 'חומרי הוראה לסגל'`);
    const { body: s } = await createSummary(h, 'dlevi', summaryPayload(l));
    await h.sql('insert into folder_summaries (summary_id, folder_id) values ($1, $2)', [s._id, staff.id]);
    expect((await h.as('dlevi').get(`/summary/${s._id}/false`)).body.folder).toBeNull();

    await h
      .as('dlevi')
      .put('/summary')
      .field('summary', JSON.stringify(summaryPayload(l, { id: s._id, folderId: null })))
      .expect(200);
    expect(await h.sql('select 1 from folder_summaries where summary_id = $1 and folder_id = $2', [s._id, staff.id])).toHaveLength(1);
  });

  it('comments: viewers comment, the author is notified, only the comment author deletes', async () => {
    const { body: s } = await createSummary(h, 'mgolan', summaryPayload(l));
    const c = (await h.as('dlevi').put('/comment').send({ summaryId: s._id, content: 'תגובה', mentions: [] }).expect(200)).body;
    expect(c).toMatchObject({ content: 'תגובה', user: { username: 'dlevi' } });
    expect((await h.as('mgolan').get('/notifications')).body.some((n: { text: string }) => n.text.includes('הגיב/ה'))).toBe(true);
    await h.as('nmizrahi').put('/comment').send({ summaryId: s._id, content: 'x' }).expect(404);
    await h.as('mgolan').delete(`/comment/${c._id}`).send({ summaryId: s._id }).expect(403);
    await h.as('dlevi').delete(`/comment/${c._id}`).send({ summaryId: s._id }).expect(200);
  });

  it('favourites, pins and follows toggle idempotently and return the updated IUser', async () => {
    const { body: s } = await createSummary(h, 'mgolan', summaryPayload(l));
    await h.as('dlevi').put('/user/favorite').send({ summaryId: s._id }).expect(200);
    const fav = await search('dlevi', 'summarySearch=FAVORITE&isProfile=true');
    expect(fav.summaries.map((x: { _id: string }) => x._id)).toContain(s._id);
    expect(fav.summaries.find((x: { _id: string }) => x._id === s._id).isFavorite).toBe(true);
    await h.as('dlevi').put('/user/favorite').send({ summaryId: s._id }).expect(200);
    expect((await search('dlevi', 'summarySearch=FAVORITE&isProfile=true')).lengths.favorite).toBe(0);

    // cannot favourite what you cannot see
    await h.as('nmizrahi').put('/user/favorite').send({ summaryId: s._id }).expect(404);

    const pinned = (await h.as('dlevi').post('/user/pinned-label/').send({ label: 'חשוב' }).expect(201)).body;
    expect(pinned.pinnedLabels).toEqual(['חשוב']);
    expect((await h.as('dlevi').post('/user/pinned-label/').send({ label: 'חשוב' })).body.pinnedLabels).toEqual([]);

    const search1 = { text: 'גרפים', searchTypes: ['TITLE'], sort: '-eventDate' };
    expect((await h.as('dlevi').post('/user/pinned-search/').send({ ...search1, isPin: true })).body.pinnedSearches).toHaveLength(1);
    expect((await h.as('dlevi').post('/user/pinned-search/').send({ ...search1, sort: 'title', isPin: true })).body.pinnedSearches).toHaveLength(1);
    expect((await h.as('dlevi').post('/user/pinned-search/').send({ ...search1, isPin: false })).body.pinnedSearches).toHaveLength(0);

    const followed = (await h.as('dlevi').put(`/user/add-follow/${l.user('aperetz')}`).expect(200)).body;
    expect(followed.following).toContain(l.user('aperetz'));
    await h.as('dlevi').put(`/user/add-follow/${l.user('aperetz')}`).expect(200);
    await h.as('dlevi').put(`/user/add-follow/${l.user('dlevi')}`).expect(400);
    expect((await h.as('dlevi').delete(`/user/remove-follow/${l.user('aperetz')}`)).body.following).not.toContain(l.user('aperetz'));
  });

  it('summary templates: personal, saved by name, and drop what the owner can no longer see', async () => {
    const template = {
      name: 'הקורס שלי',
      permissions: [l.perm('cs-faculty')],
      taggedUsers: [l.user('aperetz'), l.user('aperetz')],
      labels: ['שבוע 1'],
    };

    const [saved] = (await h.as('dlevi').post('/user/templates').send(template).expect(201)).body;
    expect(saved).toMatchObject({
      name: 'הקורס שלי',
      permissions: [l.perm('cs-faculty')],
      taggedUsers: [{ username: 'aperetz' }],
      labels: ['שבוע 1'],
      folder: null,
    });

    // Same name replaces; templates are per user.
    const list = (await h.as('dlevi').post('/user/templates').send({ ...template, labels: ['שבוע 2'] }).expect(201)).body;
    expect(list).toHaveLength(1);
    expect(list[0].labels).toEqual(['שבוע 2']);
    expect((await h.as('mgolan').get('/user/templates').expect(200)).body).toEqual([]);

    await h.as('dlevi').post('/user/templates').send({ ...template, name: ' ' }).expect(400);
    await h.as('mgolan').delete(`/user/templates/${saved._id}`).expect(404);
    expect((await h.as('dlevi').delete(`/user/templates/${saved._id}`).expect(200)).body).toEqual([]);
  });

  it('attachments: Hebrew file names round-trip; kept/removed on edit; download checks access', async () => {
    const payload = summaryPayload(l);
    const created = await h
      .as('mgolan')
      .post('/summary')
      .field('summary', JSON.stringify(payload))
      .attach('files', Buffer.from('hello'), { filename: 'סיכום שיעור.pdf', contentType: 'application/pdf' })
      .attach('files', Buffer.from('bye'), { filename: 'b.txt', contentType: 'text/plain' })
      .expect(201);
    const s = created.body;
    expect(s.files.sort()).toEqual(['b.txt', 'סיכום שיעור.pdf']);

    const dl = await h.as('dlevi').get(`/summary/download?summaryId=${s._id}&fileName=${encodeURIComponent('סיכום שיעור.pdf')}`).buffer(true).expect(200);
    expect(dl.body.toString()).toBe('hello');
    await h.as('nmizrahi').get(`/summary/download?summaryId=${s._id}&fileName=b.txt`).expect(404);

    const edited = await h
      .as('mgolan')
      .put('/summary')
      .field('summary', JSON.stringify({ ...payload, id: s._id, files: ['b.txt'] }))
      .expect(200);
    expect(edited.body.files).toEqual(['b.txt']);
    await h.as('mgolan').get(`/summary/download?summaryId=${s._id}&fileName=${encodeURIComponent('סיכום שיעור.pdf')}`).expect(404);
  });

  it('colour, timeline title and to-draft', async () => {
    const { body: s } = await createSummary(h, 'mgolan', summaryPayload(l));
    await h.as('dlevi').put('/summary/color').send({ id: s._id, summaryId: s._id, color: '#ff0000' }).expect(200);
    await h.as('dlevi').put('/summary/color').send({ id: s._id, color: 'red;}' }).expect(400);
    await h.as('dlevi').put('/summary/updateTimelineTitle').send({ id: s._id, timelineTitle: 'x' }).expect(403);
    await h.as('mgolan').put('/summary/updateTimelineTitle').send({ id: s._id, summaryId: s._id, timelineTitle: 'ציר' }).expect(200);
    await h.as('mgolan').put('/summary/to-draft').send({ id: s._id }).expect(200);
    const after = (await h.as('mgolan').get(`/summary/${s._id}/true`)).body;
    expect(after).toMatchObject({ color: '#ff0000', timelineTitle: 'ציר', isDraft: true });
    await h.as('dlevi').get(`/summary/${s._id}/false`).expect(404);
  });

  it('capsules: autocomplete and lookup, #name in the text, #cap:id in the advanced tree', async () => {
    const names = (await h.as('mgolan').get('/capsules').query({ q: 'עצ' }).expect(200)).body.map((c: { name: string }) => c.name);
    expect(names[0]).toBe('עצים');
    expect((await h.as('mgolan').get('/capsules').query({ ids: 'cap-trees,nope', names: 'חשוב_למבחן' })).body.map((c: { _id: string }) => c._id)).toEqual([
      'cap-trees',
      'cap-exam-important',
    ]);

    const count = async (text: string, query?: object) =>
      (await h.as('mgolan').get('/summary/count').query({ text, ...(query ? { query: JSON.stringify(query) } : {}) }).expect(200)).body.count as number;
    // A capsule is its words under their conditions: optional → any of, must → all of, mustNot → none of.
    const trees = await count('#עצים');
    expect(trees).toBeGreaterThan(0);
    expect(trees).toBe(await count('עצי or עץ or AVL or "עצי B" or סיבובים or ערימות'));
    expect(await count('#חשוב_למבחן')).toBe(await count('מבחן'));
    expect(await count('#מבני_נתונים_בלי_עצים')).toBe(await count('"מבני נתונים" not עצי not AVL not עץ'));
    expect(await count('not #עצים')).toBe((await count('')) - trees);
    expect(await count('#אין_כמוסה_כזו')).toBe(await count('אין_כמוסה_כזו')); // not a capsule: the plain word

    const anyOf = (...words: string[]) => ({ type: 'group', op: 'AND', children: [{ type: 'cond', field: 'text', op: 'any', words }] });
    expect(await count('', anyOf('#cap:cap-trees'))).toBe(trees);
    expect(await count('', anyOf('#cap:gone'))).toBe(0);
  });

  it('notification rules on the summary text, with a capsule', async () => {
    const rule = { field: { _id: 'summary-text' }, funcName: 'capsuleMatches', content: ['cap-trees', 'עצים'] };
    await h.as('dlevi').post('/notifications').send({ name: 'עצים חדשים', conditions: [{ ...rule, content: [] }], isNotify: true }).expect(400);
    const saved = (await h.as('dlevi').post('/notifications').send({ name: 'עצים חדשים', conditions: [rule], isNotify: true }).expect(201)).body;
    expect(saved.conditions[0].field).toEqual({ _id: 'summary-text', name: 'תוכן התמצית', type: 'string' });

    const notified = async () => (await h.as('dlevi').get('/notifications')).body.filter((n: { text: string }) => n.text.includes('עצים חדשים')).length;
    await createSummary(h, 'mgolan', summaryPayload(l, { title: 'טבלאות גיבוב' }));
    expect(await notified()).toBe(0);
    await createSummary(h, 'mgolan', summaryPayload(l, { title: 'סיבובים', contentHtml: '<p>עצי AVL</p>' }));
    expect(await notified()).toBe(1);
    await h.as('dlevi').delete(`/notifications/${saved._id}`).expect(200);
  });

  it('notification rules: an edit that starts matching notifies, once; any-of rules; saved-search alerts', async () => {
    const inbox = async (name: string) => (await h.as('dlevi').get('/notifications')).body.filter((n: { text: string }) => n.text.includes(name)).length;
    const update = (id: string, over: object) =>
      h
        .as('mgolan')
        .put('/summary')
        .field('summary', JSON.stringify(summaryPayload(l, { id, ...over })))
        .expect(200);
    const text = (word: string) => ({ field: { _id: 'summary-text' }, funcName: 'stringContains', content: [word] });

    // all-of by default; any-of with matchAny
    const both = (await h.as('dlevi').post('/notifications').send({ name: 'שניהם', conditions: [text('ינשוף'), text('תנשמת')] }).expect(201)).body;
    const either = (await h.as('dlevi').post('/notifications').send({ name: 'אחד מהם', conditions: [text('ינשוף'), text('תנשמת')], matchAny: true }).expect(201)).body;
    expect(either.matchAny).toBe(true);
    await h.as('dlevi').post('/notifications').send({ name: 'ריק', conditions: [] }).expect(400);

    const { body: s } = await createSummary(h, 'mgolan', summaryPayload(l, { title: 'עופות' }));
    expect([await inbox('שניהם'), await inbox('אחד מהם')]).toEqual([0, 0]);

    await update(s._id, { title: 'עופות', contentHtml: '<p>ינשוף</p>' });
    expect([await inbox('שניהם'), await inbox('אחד מהם')]).toEqual([0, 1]);
    expect((await h.as('dlevi').get('/notifications')).body.some((n: { text: string }) => n.text.includes('שעודכנה'))).toBe(true);

    // matching again on the next edit doesn't notify again; a rule that starts matching does
    await update(s._id, { title: 'עופות', contentHtml: '<p>ינשוף ותנשמת</p>' });
    expect([await inbox('שניהם'), await inbox('אחד מהם')]).toEqual([1, 1]);
    for (const r of [both, either]) await h.as('dlevi').delete(`/notifications/${r._id}`).expect(200);

    // a saved search, matched with the feed's own filters (text + a content type); paging and sort are dropped
    const alert = (await h.as('dlevi').post('/notifications').send({ name: 'ינשופים כלליים', search: { text: 'ינשוף', contentTypes: ['generic'], sort: 'title', skip: 40 } }).expect(201)).body;
    expect(alert.search).toEqual({ text: 'ינשוף', contentTypes: ['generic'] });
    expect(alert.conditions).toEqual([]);
    await h.as('dlevi').post('/notifications').send({ name: 'רע', search: { query: '{nope' } }).expect(400);
    await createSummary(h, 'mgolan', summaryPayload(l, { title: 'ינשוף', contentType: l.type('lecture'), summaryFields: [{ field: (await h.sql<{ id: string }>(`select id from fields where name = 'שם הקורס'`))[0].id, value: 'קורס' }] }));
    expect(await inbox('ינשופים כלליים')).toBe(0); // not generic
    await createSummary(h, 'mgolan', summaryPayload(l, { title: 'ינשוף לבן' }));
    expect(await inbox('ינשופים כלליים')).toBe(1);
    await h.as('dlevi').delete(`/notifications/${alert._id}`).expect(200);
  });

  it('notification rules: CRUD per user, and a matching new summary notifies the rule owner', async () => {
    const field = (await h.sql<{ id: string }>(`select id from fields where name = 'שם הקורס'`))[0].id;
    const rule = (
      await h
        .as('dlevi')
        .post('/notifications')
        .send({ name: 'כלל', conditions: [{ field: { _id: field }, funcName: 'stringContains', content: ['חדו'] }], isMail: false, isNotify: true })
        .expect(201)
    ).body;
    expect(rule.conditions[0].field).toEqual({ _id: field, name: 'שם הקורס', type: 'string' });
    expect((await h.as('mgolan').get('/notifications/settings')).body.some((r: { _id: string }) => r._id === rule._id)).toBe(false);

    await createSummary(h, 'mgolan', summaryPayload(l, { contentType: l.type('lecture'), summaryFields: [{ field, value: 'חדו"א 2' }] }));
    expect((await h.as('dlevi').get('/notifications')).body.some((n: { text: string }) => n.text.includes('כלל'))).toBe(true);

    await h.as('dlevi').put('/notifications/all-viewed').expect(200);
    expect((await h.as('dlevi').get('/notifications')).body.every((n: { isViewed: boolean }) => n.isViewed)).toBe(true);
    await h.as('mgolan').delete(`/notifications/${rule._id}`).expect(404);
    await h.as('dlevi').delete(`/notifications/${rule._id}`).expect(200);
  });

  it('excel: template, export of visible summaries, and all-or-nothing import', async () => {
    const tpl = await h.as('mgolan').post('/summary/download/template').send({ fieldNames: ['כותרת', 'תוכן'] }).responseType('blob').expect(201);
    expect(tpl.headers['content-type']).toContain('spreadsheetml');

    const exp = await h.as('mgolan').post('/summary/download/excel').send({ summariesId: [], all: true, search: { text: 'גרפים' } }).responseType('blob').expect(201);
    const XLSX = await import('xlsx');
    const rows = XLSX.utils.sheet_to_json<string[]>(XLSX.read(exp.body).Sheets.Summer, { header: 1 });
    expect(rows[0][0]).toBe('כותרת');
    expect(rows.slice(1).every((r) => String(r[0]).includes('גרפים'))).toBe(true);

    const word = await h
      .as('mgolan')
      .post('/summary/download/word')
      .send({ summariesId: [], all: true, search: { text: 'גרפים' }, title: 'דוח גרפים', intro: 'פתיח\nשורה שנייה', outro: 'סיכום' })
      .responseType('blob')
      .expect(201);
    expect(word.headers['content-type']).toContain('wordprocessingml');
    const docXml = Buffer.from(XLSX.CFB.find(XLSX.CFB.read(word.body, { type: 'buffer' }), '/word/document.xml')!.content).toString('utf8');
    for (const text of ['דוח גרפים', 'פתיח', 'שורה שנייה', 'סיכום', 'תאריך האירוע', String(rows[1][0])]) expect(docXml).toContain(text);
    expect(docXml.indexOf('פתיח')).toBeLessThan(docXml.indexOf('<w:tbl>'));
    expect(docXml.indexOf('סיכום')).toBeGreaterThan(docXml.indexOf('</w:tbl>'));

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['כותרת', 'תוכן', 'תגיות'], ['מיובא 1', '<b>a</b>', 'יבוא, חשוב'], ['מיובא 2', 'b', '']]), 'S');
    const file = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const imported = await h
      .as('mgolan')
      .post('/summary/upload/excel')
      .attach('file', file, 'import.xlsx')
      .field('type', l.type('generic'))
      .field('permissions', l.perm('cs-faculty'))
      .field('headersMap', JSON.stringify({ כותרת: 'title', תוכן: 'content', תגיות: 'labels' }))
      .expect(201);
    expect(imported.body).toEqual({ created: 2 });
    const [row] = await h.sql<{ content_html: string }>(`select content_html from summaries where title = 'מיובא 1'`);
    expect(row.content_html).toBe('<p>&lt;b&gt;a&lt;/b&gt;</p>');
  });

  it('dashboard groups by first label and is limited to dashboard groups', async () => {
    const res = await h.as('mgolan').get(`/summary/user/${await myId('mgolan')}/dashboard`).expect(200);
    expect(Object.keys(res.body).length).toBeGreaterThan(1);
    await h.as('dlevi').get(`/summary/user/x/dashboard`).expect(403);
  });
});
