import { Harness, createHarness } from './harness';
import { Lookups, createSummary, lookups, summaryPayload } from './fixtures';

// Profile milestones: GET /milestones/:userId → the ids earned, judged over all of the author's published summaries.
describe('milestones', () => {
  let h: Harness;
  let l: Lookups;
  const author = 'efriedman';

  beforeAll(async () => {
    h = await createHarness();
    l = await lookups(h);
  });
  afterAll(() => h.close());

  beforeEach(() => h.sql('delete from summaries where created_by = $1', [l.user(author)]));

  const earned = async (viewer = author) => {
    const res = await h.as(viewer).get(`/milestones/${l.user(author)}`);
    expect(res.status).toBe(200);
    return res.body.earned as string[];
  };
  const create = async (over: Record<string, unknown> = {}) => (await createSummary(h, author, summaryPayload(l, over))).body._id as string;
  /** Move a summary's creation to a wall-clock time in APP_TIMEZONE (Asia/Jerusalem in tests). */
  const createdAt = (id: string, local: string) =>
    h.sql(`update summaries set created_at = $2::timestamp at time zone 'Asia/Jerusalem', updated_at = $2::timestamp at time zone 'Asia/Jerusalem' where id = $1`, [id, local]);

  it('nothing is earned without published summaries; drafts do not count', async () => {
    expect(await earned()).toEqual([]);
    await create({ isDraft: true });
    expect(await earned()).toEqual([]);
  });

  it('a bad id is a 404, an unknown user has nothing earned', async () => {
    expect((await h.as(author).get('/milestones/nope')).status).toBe(404);
    expect((await h.as(author).get('/milestones/00000000-0000-4000-8000-000000000000')).body).toEqual({ earned: [] });
  });

  it('counts every summary, including ones the viewer cannot see', async () => {
    await create();
    // nmizrahi lacks cs-faculty, so this summary is hidden from her — the milestone still counts.
    expect(await earned('nmizrahi')).toContain('first');
    expect(await earned('nmizrahi')).toEqual(await earned());
  });

  it('time milestones use local time', async () => {
    await createdAt(await create(), '2026-03-07 00:00'); // Saturday, midnight
    await createdAt(await create(), '2026-10-24 06:00'); // Summer's birthday, early
    const got = await earned();
    expect(got).toEqual(expect.arrayContaining(['night-owl', 'midnight', 'weekend', 'early-bird', 'birthday']));
    expect(got).not.toContain('summer');
  });

  it('7 consecutive days make a streak; 5 days in one Sunday–Saturday week make a full week', async () => {
    for (let day = 1; day <= 6; day++) await createdAt(await create(), `2026-03-0${day} 12:00`);
    expect(await earned()).not.toContain('streak');
    expect(await earned()).toContain('full-week'); // Sun 1 – Fri 6 March
    await createdAt(await create(), '2026-03-07 12:00');
    expect(await earned()).toContain('streak');
  });

  it('a full week does not span two weeks', async () => {
    // Thu 5 – Mon 9 March: five days, but split across two Sunday–Saturday weeks.
    for (let day = 5; day <= 9; day++) await createdAt(await create(), `2026-03-0${day} 12:00`);
    expect(await earned()).not.toContain('full-week');
  });

  it('content milestones read the plain text', async () => {
    await create({ contentHtml: `<p>${'א'.repeat(100)}</p>` });
    const got = await earned();
    expect(got).toEqual(expect.arrayContaining(['exactly-100', 'tldr']));
    expect(got).not.toContain('epic');
  });

  it('event-date milestones compare the event with when it was written', async () => {
    await createdAt(await create({ eventDate: '2026-03-10' }), '2026-03-10 20:00');
    await createdAt(await create({ eventDate: '2024-01-01' }), '2026-03-10 20:00');
    expect(await earned()).toEqual(expect.arrayContaining(['live', 'archaeology']));
  });
});
