import { Harness, createHarness } from './harness';
import { Lookups, createSummary, lookups, summaryPayload } from './fixtures';

describe('summaries, collections, comments, personal state', () => {
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

  it('collections: needs permissions; adding needs summary edit rights; removal and deletion keep the summary', async () => {
    await h.as('mgolan').post('/collection/create').send({ name: 'ריק', permissions: [], managers: [] }).expect(400);
    const col = (await h.as('mgolan').post('/collection/create').send({ name: 'אוסף בדיקה', permissions: [l.perm('cs-faculty')], managers: [] }).expect(201)).body;
    expect(col.managers).toEqual([l.user('mgolan')]);

    const { body: s } = await createSummary(h, 'mgolan', summaryPayload(l));
    await h.as('dlevi').post('/collection/add').send({ collectionIds: [col._id], summaryIds: [s._id] }).expect(403);
    await h.as('mgolan').post('/collection/add').send({ collectionIds: [col._id], summaryIds: [s._id] }).expect(201);
    expect((await h.as('mgolan').get(`/collection/${col._id}`)).body.summaries).toEqual([s._id]);
    expect((await h.as('mgolan').get(`/summary/${s._id}/false`)).body.collectionIds).toEqual([{ _id: col._id, name: 'אוסף בדיקה' }]);

    await h.as('dlevi').post(`/collection/edit/${col._id}`).send({ name: 'x', permissions: [l.perm('cs-faculty')], managers: [] }).expect(403);
    await h.as('mgolan').post(`/collection/edit/${col._id}`).send({ name: 'אוסף', permissions: [l.perm('cs-faculty')], managers: [], summaries: [s._id] }).expect(201);
    expect((await h.as('mgolan').get(`/collection/${col._id}`)).body.summaries).toEqual([]);

    await h.as('mgolan').delete(`/collection/${col._id}`).expect(200);
    await h.as('mgolan').get(`/summary/${s._id}/false`).expect(200);
  });

  it('keeps memberships in collections the editor cannot see when they save the summary', async () => {
    // A math-only collection (dlevi cannot see it) holding dlevi's summary.
    const col = (await h.as('mgolan').post('/collection/create').send({ name: 'מתמטיקה בלבד', permissions: [l.perm('math-faculty')], managers: [] })).body;
    const { body: s } = await createSummary(h, 'dlevi', summaryPayload(l));
    await h.sql('insert into summary_collections (summary_id, collection_id) values ($1, $2)', [s._id, col._id]);

    await h
      .as('dlevi')
      .put('/summary')
      .field('summary', JSON.stringify(summaryPayload(l, { id: s._id, collectionIds: [] })))
      .expect(200);
    expect(await h.sql('select 1 from summary_collections where summary_id = $1 and collection_id = $2', [s._id, col._id])).toHaveLength(1);
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
