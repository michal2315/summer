import { Harness, createHarness } from './harness';
import { Lookups, createSummary, lookups, summaryPayload } from './fixtures';

// Hierarchy rules (DECISIONS.md F1–F6).
describe('folders (hierarchy)', () => {
  let h: Harness;
  let l: Lookups;
  let folder: (name: string) => Promise<string>;

  beforeAll(async () => {
    h = await createHarness();
    l = await lookups(h);
    folder = async (name) => (await h.sql<{ id: string }>('select id from folders where name = $1', [name]))[0].id;
  });
  afterAll(() => h.close());

  const treeNames = async (username: string) => ((await h.as(username).get('/folder').expect(200)).body as { name: string }[]).map((f) => f.name).sort();

  it('returns the IFolder shape and only folders whose whole ancestor chain is visible (all-of)', async () => {
    const tree = (await h.as('mgolan').get('/folder')).body;
    expect(tree.find((f: { name: string }) => f.name === 'מדעי המחשב')).toMatchObject({
      parentId: await folder('סמסטר א׳'),
      permissions: [{ groupName: 'cs-faculty' }],
      managers: [l.user('mgolan')],
      createdBy: { username: 'mgolan' },
    });
    // mgolan lacks behavioral; nmizrahi lacks cs, math and staff.
    expect(await treeNames('mgolan')).toEqual(['חומרי הוראה לסגל', 'מדעי המחשב', 'מתמטיקה', 'סמסטר א׳', 'סמסטר ב׳', 'שנה א׳'].sort());
    expect(await treeNames('nmizrahi')).toEqual(['מדעי ההתנהגות', 'סמסטר א׳', 'סמסטר ב׳', 'שנה א׳'].sort());

    // A year-1 subfolder under the cs folder stays hidden from nmizrahi: she fails the ancestor's requirement.
    const sub = (await h.as('mgolan').post('/folder/create').send({ name: 'תת-תיקייה', parentId: await folder('מדעי המחשב'), permissions: [l.perm('year-1')], managers: [] }).expect(201)).body;
    expect(await treeNames('nmizrahi')).not.toContain('תת-תיקייה');
    await h.as('nmizrahi').get(`/folder/${sub._id}/items`).expect(404);
  });

  it('lists the summaries the caller may see, and counts only those', async () => {
    const id = await folder('מדעי המחשב');
    const items = (await h.as('mgolan').get(`/folder/${id}/items`).expect(200)).body as { _id: string; kind: string }[];
    expect(items.length).toBeGreaterThan(0);
    const tree = (await h.as('mgolan').get('/folder')).body as { _id: string; itemCount: number }[];
    expect(tree.find((f) => f._id === id)!.itemCount).toBe(items.length);
    for (const item of items) await h.as('mgolan').get(`/summary/${item._id}/false`).expect(200);
  });

  it('create: needs a permission; a subfolder needs a manager of the parent', async () => {
    await h.as('mgolan').post('/folder/create').send({ name: 'ללא הרשאות', permissions: [], managers: [] }).expect(400);
    await h.as('dlevi').post('/folder/create').send({ name: 'x', parentId: await folder('שנה א׳'), permissions: [l.perm('year-1')] }).expect(403);
    await h.as('mgolan').post('/folder/create').send({ name: 'x', parentId: await folder('חומרי הוראה לסגל'), permissions: [l.perm('staff')] }).expect(403);
    const root = (await h.as('dlevi').post('/folder/create').send({ name: 'שורש של דנה', permissions: [l.perm('year-1')], managers: [] }).expect(201)).body;
    expect(root).toMatchObject({ parentId: null, itemCount: 0, managers: [l.user('dlevi')] });
  });

  it('edit is for managers only and never moves the folder', async () => {
    const id = await folder('סמסטר ב׳');
    await h.as('dlevi').post(`/folder/edit/${id}`).send({ name: 'x', permissions: [l.perm('year-1')] }).expect(403);
    const edited = (await h.as('mgolan').post(`/folder/edit/${id}`).send({ name: 'סמסטר ב׳ (חדש)', parentId: null, permissions: [l.perm('year-1')] }).expect(201)).body;
    expect(edited).toMatchObject({ name: 'סמסטר ב׳ (חדש)', parentId: await folder('שנה א׳') });
    await expect(h.sql('update folders set parent_id = null where id = $1', [id])).rejects.toThrow(/parent cannot be changed/);
  });

  it('placing items needs folder management AND item edit rights; an item moves out of its previous folder', async () => {
    const target = await folder('סמסטר ב׳ (חדש)');
    const { body: mine } = await createSummary(h, 'mgolan', summaryPayload(l));
    const { body: theirs } = await createSummary(h, 'dlevi', summaryPayload(l));
    const { body: draft } = await createSummary(h, 'mgolan', summaryPayload(l, { isDraft: true }));

    await h.as('mgolan').post(`/folder/${target}/items`).send({ summaryIds: [theirs._id] }).expect(403);
    await h.as('mgolan').post(`/folder/${target}/items`).send({ summaryIds: [draft._id] }).expect(400);
    await h.as('dlevi').post(`/folder/${target}/items`).send({ summaryIds: [theirs._id] }).expect(403); // not a manager

    await h.as('mgolan').post(`/folder/${await folder('שנה א׳')}/items`).send({ summaryIds: [mine._id] }).expect(201);
    await h.as('mgolan').post(`/folder/${target}/items`).send({ summaryIds: [mine._id] }).expect(201);
    const placed = await h.sql<{ folder_id: string }>('select folder_id from folder_summaries where summary_id = $1', [mine._id]);
    expect(placed).toEqual([{ folder_id: target }]);

    await h.as('mgolan').post(`/folder/${target}/items/remove`).send({ summaryIds: [mine._id] }).expect(201);
    expect((await h.as('mgolan').get(`/folder/${target}/items`)).body).toEqual([]);
    await h.as('mgolan').get(`/summary/${mine._id}/false`).expect(200);
  });

  it('is navigation only: an item in a restricted folder keeps its own access', async () => {
    const staffOnly = (await h.as('mgolan').post('/folder/create').send({ name: 'סגל בלבד', permissions: [l.perm('staff')] }).expect(201)).body;
    const { body: s } = await createSummary(h, 'mgolan', summaryPayload(l, { permissions: [l.perm('cs-faculty')] }));
    await h.as('mgolan').post(`/folder/${staffOnly._id}/items`).send({ summaryIds: [s._id] }).expect(201);

    await h.as('dlevi').get(`/folder/${staffOnly._id}/items`).expect(404); // no staff group
    await h.as('dlevi').get(`/summary/${s._id}/false`).expect(200); // still reachable on its own permissions
  });

  it('deleting a folder deletes its subtree; the items inside are kept', async () => {
    const top = await folder('שנה א׳');
    const summariesBefore = (await h.sql<{ n: number }>('select count(*)::int n from summaries'))[0].n;
    await h.as('dlevi').delete(`/folder/${top}`).expect(403);
    await h.as('mgolan').delete(`/folder/${top}`).expect(200);
    expect(await treeNames('mgolan')).toEqual(['חומרי הוראה לסגל', 'סגל בלבד', 'שורש של דנה']);
    expect((await h.sql<{ n: number }>('select count(*)::int n from summaries'))[0].n).toBe(summariesBefore);
  });

  it('the database refuses a folder without permissions', async () => {
    await expect(h.sql(`insert into folders (name, created_by) values ('x', $1)`, [l.user('mgolan')])).rejects.toThrow(/at least one permission/);
  });
});
