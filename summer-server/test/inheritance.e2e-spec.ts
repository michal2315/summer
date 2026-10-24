import { Harness, createHarness } from './harness';
import { Lookups, createSummary, lookups, summaryPayload } from './fixtures';

// ACCESS_INHERIT_COLLECTION_PERMISSIONS=true (handoff §4, proposed): a summary also requires the groups of every
// collection containing it — viewing it anywhere needs A (own) + B + C (its collections).
describe('collection permission inheritance (flag on)', () => {
  let h: Harness;
  let l: Lookups;

  beforeAll(async () => {
    h = await createHarness({ ACCESS_INHERIT_COLLECTION_PERMISSIONS: 'true' });
    l = await lookups(h);
  });
  afterAll(async () => {
    await h.close();
    process.env.ACCESS_INHERIT_COLLECTION_PERMISSIONS = 'false';
  });

  it('adding a summary to a more restrictive collection hides it from users missing that group, on every route', async () => {
    const { body: s } = await createSummary(h, 'mgolan', summaryPayload(l, { permissions: [l.perm('cs-faculty')] }));
    await h.as('efriedman').get(`/summary/${s._id}/false`).expect(200); // cs-faculty only

    const col = (await h.as('mgolan').post('/collection/create').send({ name: 'שנה א׳', permissions: [l.perm('year-1')], managers: [] })).body;
    await h.as('mgolan').post('/collection/add').send({ collectionIds: [col._id], summaryIds: [s._id] }).expect(201);

    await h.as('efriedman').get(`/summary/${s._id}/false`).expect(404); // now also needs year-1
    await h.as('dlevi').get(`/summary/${s._id}/false`).expect(200); // cs-faculty + year-1
  });
});
