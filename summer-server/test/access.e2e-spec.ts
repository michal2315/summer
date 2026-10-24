import request from 'supertest';
import { Harness, createHarness } from './harness';
import { Lookups, createSummary, lookups, summaryPayload } from './fixtures';

// Handoff §17: permission A+B, empty sets, editor ≠ viewer, drafts, direct-URL parity, notification re-authorization.
describe('access rules', () => {
  let h: Harness;
  let l: Lookups;

  beforeAll(async () => {
    h = await createHarness();
    l = await lookups(h);
  });
  afterAll(() => h.close());

  const feedIds = async (username: string) => {
    const me = (await h.as(username).get('/user')).body;
    const res = await h.as(username).get(`/summary/user/${me._id}?limit=100`);
    return (res.body.summaries as { _id: string }[]).map((s) => s._id);
  };

  it('requires ALL assigned permissions (A+B): A alone is denied, A+B allowed — in feed, direct read and search', async () => {
    const { status, body } = await createSummary(h, 'mgolan', summaryPayload(l, { title: 'דרישה כפולה xyzzy', permissions: [l.perm('cs-faculty'), l.perm('year-1')] }));
    expect(status).toBe(201);

    // dlevi: cs-faculty + year-1 → allowed
    expect(await feedIds('dlevi')).toContain(body._id);
    await h.as('dlevi').get(`/summary/${body._id}/false`).expect(200);

    // efriedman: cs-faculty only → denied everywhere, without disclosing existence
    expect(await feedIds('efriedman')).not.toContain(body._id);
    await h.as('efriedman').get(`/summary/${body._id}/false`).expect(404);
    const me = (await h.as('efriedman').get('/user')).body;
    const search = await h.as('efriedman').get(`/summary/user/${me._id}?text=xyzzy`);
    expect(search.body.lengths.summary).toBe(0);
  });

  it('rejects a published summary with no permissions, but allows a private draft', async () => {
    expect((await createSummary(h, 'mgolan', summaryPayload(l, { permissions: [] }))).status).toBe(400);
    const draft = await createSummary(h, 'mgolan', summaryPayload(l, { permissions: [], isDraft: true, title: 'טיוטה פרטית' }));
    expect(draft.status).toBe(201);
    await h.as('mgolan').get(`/summary/${draft.body._id}/false`).expect(200);
    await h.as('dlevi').get(`/summary/${draft.body._id}/false`).expect(404);
  });

  it('the database refuses to leave a published summary without permissions', async () => {
    const [row] = await h.sql<{ id: string }>('select id from summaries where not is_draft limit 1');
    await expect(h.sql(`delete from summary_permissions where summary_id = $1`, [row.id])).rejects.toThrow(/at least one permission/);
  });

  it('refuses to assign a permission group the author does not belong to', async () => {
    const res = await createSummary(h, 'dlevi', summaryPayload(l, { permissions: [l.perm('math-faculty')] }));
    expect(res.status).toBe(400);
  });

  it('editing needs editor rights on top of viewing; hidden summaries answer 404', async () => {
    const { body } = await createSummary(h, 'mgolan', summaryPayload(l, { title: 'רק מיכל עורכת' }));
    const update = (username: string) =>
      h
        .as(username)
        .put('/summary')
        .field('summary', JSON.stringify(summaryPayload(l, { id: body._id, title: 'שונה' })));

    expect((await update('dlevi')).status).toBe(403); // sees it, is not an editor
    expect((await update('nmizrahi')).status).toBe(404); // cannot see it at all
    await h.as('dlevi').delete('/summary').send({ id: body._id }).expect(403);
    await h.as('dlevi').put('/summary/to-draft').send({ id: body._id }).expect(403);
    expect((await update('mgolan')).status).toBe(200);
  });

  it('rejects a stale optimistic-concurrency version with 409', async () => {
    const { body } = await createSummary(h, 'mgolan', summaryPayload(l));
    const put = (version: number) =>
      h
        .as('mgolan')
        .put('/summary')
        .field('summary', JSON.stringify(summaryPayload(l, { id: body._id, version })));
    expect((await put(1)).status).toBe(200);
    expect((await put(1)).status).toBe(409);
  });

  it('notifies followers on publish, and hides the notification once the follower loses access', async () => {
    // seed: mgolan follows dlevi
    const { body } = await createSummary(h, 'dlevi', summaryPayload(l, { title: 'פרסום חדש למעקב' }));
    const inbox = async () => (await h.as('mgolan').get('/notifications')).body as { summaryId?: string; text: string }[];
    expect((await inbox()).some((n) => n.summaryId === body._id)).toBe(true);

    // dlevi narrows access to a group mgolan lacks (behavioral)… dlevi lacks it too, so do it directly in SQL.
    await h.sql(`insert into summary_permissions (summary_id, permission_id) values ($1, $2)`, [body._id, l.perm('behavioral')]);
    expect((await inbox()).some((n) => n.summaryId === body._id)).toBe(false);
  });

  it('does not create notifications for users who cannot see the summary', async () => {
    // nmizrahi is tagged but lacks cs-faculty
    const { body } = await createSummary(h, 'mgolan', summaryPayload(l, { taggedUsers: [l.user('nmizrahi'), l.user('dlevi')] }));
    const rows = await h.sql<{ username: string }>(
      `select u.username from notifications n join users u on u.id = n.user_id where n.summary_id = $1`,
      [body._id],
    );
    expect(rows.map((r) => r.username).sort()).toEqual(['dlevi']);
  });

  it('ignores the client-supplied _id header: identity comes only from the token', async () => {
    const res = await h.as('dlevi').get('/user').set('_id', l.user('mgolan'));
    expect(res.body.username).toBe('dlevi');
    await request(h.app.getHttpServer()).get('/api/user').set('_id', l.user('mgolan')).expect(401);
    await request(h.app.getHttpServer()).get('/api/user').set('authorization', 'bearer dev.forged.token').expect(401);
  });

  it('permission admin: only admin groups may manage, and an assigned permission cannot be deleted', async () => {
    await h.as('dlevi').put('/permissions').send({ name: 'x', groupName: 'x', color: '#000000' }).expect(403);
    await h.as('mgolan').delete(`/permissions/${l.perm('cs-faculty')}`).expect(409);
    const created = await h.as('mgolan').put('/permissions').send({ name: 'קבוצה חדשה', groupName: 'new-group', color: '#123456' }).expect(200);
    await h.as('mgolan').delete(`/permissions/${created.body._id}`).expect(200);
  });
});
