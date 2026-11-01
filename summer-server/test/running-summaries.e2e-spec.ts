import { Harness, createHarness } from './harness';
import { Lookups, createSummary, lookups, summaryPayload } from './fixtures';

// Running summaries (תמצית רצף) and their sumaroons (תמציתוניות).
describe('running summaries and sumaroons', () => {
  let h: Harness;
  let l: Lookups;

  beforeAll(async () => {
    h = await createHarness();
    l = await lookups(h);
  });
  afterAll(() => h.close());

  const myId = async (username: string) => (await h.as(username).get('/user')).body._id as string;
  const search = async (username: string, query: string) => (await h.as(username).get(`/summary/user/${await myId(username)}?${query}`)).body;
  const update = (username: string, payload: object) => h.as(username).put('/summary').field('summary', JSON.stringify(payload));

  const running = (over: Record<string, unknown> = {}) =>
    summaryPayload(l, { kind: 'running', title: 'ספר 1 פרק 3', rangeStart: '2026-01-01', rangeEnd: '2026-01-31', labels: ['פרק 3'], ...over });
  const sumaroon = (parentId: string, over: Record<string, unknown> = {}) =>
    summaryPayload(l, { kind: 'sumaroon', parentId, title: 'פסקה', eventDate: '2026-01-15', permissions: [], link: 'https://example.org/p', ...over });

  it('a running summary needs a date range; it starts with no sumaroons', async () => {
    expect((await createSummary(h, 'mgolan', running({ rangeStart: null }))).status).toBe(400);
    expect((await createSummary(h, 'mgolan', running({ rangeStart: '2026-02-01' }))).status).toBe(400);
    const { status, body } = await createSummary(h, 'mgolan', running());
    expect(status).toBe(201);
    expect(body).toMatchObject({ kind: 'running', rangeStart: '2026-01-01', rangeEnd: '2026-01-31', sumaroonCount: 0 });
  });

  it('a sumaroon must be dated inside the range, use the same content type and stay out of folders', async () => {
    const parent = (await createSummary(h, 'mgolan', running())).body;
    expect((await createSummary(h, 'mgolan', sumaroon(parent._id, { eventDate: '2026-02-01' }))).status).toBe(400);
    expect((await createSummary(h, 'mgolan', sumaroon(parent._id, { eventDate: undefined }))).status).toBe(400);
    expect((await createSummary(h, 'mgolan', sumaroon(parent._id, { contentType: l.type('lecture') }))).status).toBe(400);
    const [folder] = await h.sql<{ id: string }>(`select id from folders where name = 'מדעי המחשב'`);
    expect((await createSummary(h, 'mgolan', sumaroon(parent._id, { folderId: folder.id }))).status).toBe(400);
    expect((await createSummary(h, 'mgolan', sumaroon(parent._id, { kind: 'summary' }))).status).toBe(400);

    const { status, body } = await createSummary(h, 'mgolan', sumaroon(parent._id, { eventDate: '2026-01-31' }));
    expect(status).toBe(201);
    expect(body).toMatchObject({ kind: 'sumaroon', parentId: parent._id, link: 'https://example.org/p', parent: { _id: parent._id, labels: [{ name: 'פרק 3' }] } });
    expect((await h.as('mgolan').get(`/summary/${parent._id}/false`)).body).toMatchObject({ sumaroonCount: 1, sumaroonPreview: [{ _id: body._id, title: 'פסקה' }] });
  });

  it("a sumaroon's parent must be a running summary", async () => {
    const plain = (await createSummary(h, 'mgolan', summaryPayload(l))).body;
    expect((await createSummary(h, 'mgolan', sumaroon(plain._id))).status).toBe(400);
  });

  it('anyone who can see the running summary may add a sumaroon', async () => {
    const parent = (await createSummary(h, 'mgolan', running())).body;
    expect((await createSummary(h, 'dlevi', sumaroon(parent._id))).status).toBe(201);
    // nmizrahi lacks cs-faculty, so the running summary is hidden from her.
    expect((await createSummary(h, 'nmizrahi', sumaroon(parent._id))).status).toBe(400);
  });

  it("a sumaroon requires its running summary's permissions plus its own", async () => {
    const parent = (await createSummary(h, 'mgolan', running())).body;
    const open = (await createSummary(h, 'mgolan', sumaroon(parent._id, { title: 'ללא הרשאות נוספות' }))).body;
    const extra = (await createSummary(h, 'mgolan', sumaroon(parent._id, { title: 'שנה א׳ בלבד', permissions: [l.perm('year-1')] }))).body;

    // efriedman: cs-faculty only → sees the running summary and the open sumaroon, not the year-1 one.
    await h.as('efriedman').get(`/summary/${open._id}/false`).expect(200);
    await h.as('efriedman').get(`/summary/${extra._id}/false`).expect(404);
    await h.as('dlevi').get(`/summary/${extra._id}/false`).expect(200);
    expect((await h.as('efriedman').get(`/summary/${parent._id}/false`)).body.sumaroonCount).toBe(1);
    expect((await h.as('dlevi').get(`/summary/${parent._id}/false`)).body.sumaroonCount).toBe(2);

    // A running summary limited to math hides even its unrestricted sumaroons from non-math users.
    const math = (await createSummary(h, 'mgolan', running({ permissions: [l.perm('math-faculty')] }))).body;
    const child = (await createSummary(h, 'mgolan', sumaroon(math._id))).body;
    await h.as('dlevi').get(`/summary/${child._id}/false`).expect(404);
    await h.as('yavraham').get(`/summary/${child._id}/false`).expect(200);
  });

  it('lists a running summary’s sumaroons by event date or creation date; its labels find it, not its sumaroons', async () => {
    const parent = (await createSummary(h, 'mgolan', running({ labels: ['תווית-רצף-ייחודית'] }))).body;
    const late = (await createSummary(h, 'mgolan', sumaroon(parent._id, { title: 'ראשון שנכתב', eventDate: '2026-01-20' }))).body;
    const early = (await createSummary(h, 'mgolan', sumaroon(parent._id, { title: 'שני שנכתב', eventDate: '2026-01-05' }))).body;

    const byEvent = await search('mgolan', `parentId=${parent._id}&sort=eventDate`);
    expect(byEvent.summaries.map((s: { _id: string }) => s._id)).toEqual([early._id, late._id]);
    const byCreation = await search('mgolan', `parentId=${parent._id}&sort=creationDate`);
    expect(byCreation.summaries.map((s: { _id: string }) => s._id)).toEqual([late._id, early._id]);

    // The labels filter and label text search both look at a summary's own labels only.
    const ids = (r: { summaries: { _id: string }[] }) => r.summaries.map((s) => s._id);
    expect(ids(await search('mgolan', `labels=${encodeURIComponent('תווית-רצף-ייחודית')}`))).toEqual([parent._id]);
    expect(ids(await search('mgolan', `text=${encodeURIComponent('תווית-רצף')}&searchTypes=LABEL`))).toEqual([parent._id]);
  });

  it('kind and parent are fixed; a running summary with sumaroons keeps its content type and must still cover them', async () => {
    const parent = (await createSummary(h, 'mgolan', running())).body;
    await createSummary(h, 'mgolan', sumaroon(parent._id, { eventDate: '2026-01-20' }));

    expect((await update('mgolan', { ...running(), id: parent._id, kind: 'summary', rangeStart: null, rangeEnd: null })).status).toBe(400);
    expect((await update('mgolan', { ...running({ contentType: l.type('lecture') }), id: parent._id })).status).toBe(400);
    expect((await update('mgolan', { ...running({ rangeEnd: '2026-01-10' }), id: parent._id })).status).toBe(400);
    expect((await update('mgolan', { ...running({ rangeEnd: '2026-03-31', title: 'טווח מורחב' }), id: parent._id })).status).toBe(200);
  });

  it('deleting a running summary deletes its sumaroons, including ones other people wrote', async () => {
    const parent = (await createSummary(h, 'mgolan', running())).body;
    const mine = (await createSummary(h, 'mgolan', sumaroon(parent._id))).body;
    const theirs = (await createSummary(h, 'dlevi', sumaroon(parent._id))).body;
    await h.as('mgolan').delete('/summary').send({ id: parent._id }).expect(200);
    await h.as('mgolan').get(`/summary/${mine._id}/false`).expect(404);
    await h.as('dlevi').get(`/summary/${theirs._id}/false`).expect(404);
  });

  it('the seed includes a running summary with three sumaroons', async () => {
    const res = await search('mgolan', 'kinds=running&limit=100');
    const seeded = res.summaries.find((s: { title: string }) => s.title.includes('פרק 3: עצי חיפוש'));
    expect(seeded).toMatchObject({ kind: 'running', sumaroonCount: 3 });
  });
});
