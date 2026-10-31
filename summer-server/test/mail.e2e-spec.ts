import { zonedDate, zonedTimeToUtc } from '../src/common/time';
import { LogMailer, Mailer } from '../src/notifications/mailer';
import { MailWorker } from '../src/notifications/mail-worker';
import { Lookups, createSummary, lookups, summaryPayload } from './fixtures';
import { Harness, createHarness } from './harness';

const TZ = 'Asia/Jerusalem';

describe('e-mail: activity and rule mails, preferences, daily digest', () => {
  let h: Harness;
  let l: Lookups;
  let worker: MailWorker;
  let mailer: LogMailer;
  let email: (username: string) => Promise<string>;

  beforeAll(async () => {
    h = await createHarness({ MAIL_POLL_SECONDS: '0', APP_URL: 'http://summer.test/', DIGEST_HOUR: '8', APP_TIMEZONE: TZ, MAIL_TRANSPORT: 'log', MAIL_REDIRECT_TO: '', MAIL_PREVIEW_DIR: '' });
    l = await lookups(h);
    worker = h.app.get(MailWorker);
    mailer = h.app.get(Mailer) as LogMailer;
    email = async (username) => (await h.sql<{ email: string }>('select email from users where username = $1', [username]))[0].email;
  });
  afterAll(() => h.close());

  /** Before today's digest hour: only immediate mails go out. */
  const early = () => {
    const [y, m, d] = zonedDate(new Date(), TZ);
    return zonedTimeToUtc(y, m, d, 0, 1, TZ);
  };
  /** Tomorrow noon: today's digest rows are due. */
  const tomorrowNoon = () => {
    const [y, m, d] = zonedDate(new Date(Date.now() + 86_400_000), TZ);
    return zonedTimeToUtc(y, m, d, 12, 0, TZ);
  };
  const pass = async (now = early()) => {
    mailer.sent.length = 0;
    await worker.tick(now);
    return [...mailer.sent];
  };
  const text = (word: string) => ({ field: { _id: 'summary-text' }, funcName: 'stringContains', content: [word] });
  const addRule = async (username: string, body: object) => (await h.as(username).post('/notifications').send(body).expect(201)).body;

  beforeEach(async () => {
    await h.sql(`update users set mail_alerts = true, mail_activity = true`);
    await h.sql(`delete from notification_rules`);
    await pass(tomorrowNoon()); // empty the outbox
  });

  it('mails activity (tags, comments, mentions) after commit, with a link to the summary', async () => {
    const { body: s } = await createSummary(h, 'mgolan', summaryPayload(l, { title: 'גרפים', taggedUsers: [l.user('dlevi')] }));
    await h.as('aperetz').put('/comment').send({ summaryId: s._id, content: 'יפה', mentions: [{ _id: l.user('dlevi'), type: 'user', value: 'דנה' }] }).expect(200);

    const sent = await pass();
    expect(sent.map((m) => m.to).sort()).toEqual([await email('dlevi'), await email('dlevi'), await email('mgolan')].sort());
    const tag = sent.find((m) => m.subject.includes('תייג/ה'))!;
    expect(tag.subject).toContain('"גרפים"');
    expect(tag.html).toContain(`http://summer.test/summaries?summaryId=${s._id}`);
    expect(tag.html).toContain('dir="rtl"');
    const mgolan = await email('mgolan');
    const comment = sent.find((m) => m.to === mgolan)!;
    expect(comment.subject).toContain('הגיב/ה');
    const mention = sent.find((m) => m.subject.includes('הזכיר/ה אותך'))!;
    // details: the comment quoted with its author, and the summary card
    for (const m of [comment, mention]) {
      expect(m.html).toContain('אורי פרץ כתב/ה:');
      expect(m.html).toContain('>יפה</div>');
      expect(m.html).toContain('>גרפים</a>');
      expect(m.html).toContain('מאת מיכל גולן');
    }
    expect(tag.html).not.toContain('כתב/ה:'); // a tag has no comment
    expect(await pass()).toEqual([]); // sent once
  });

  it('preferences: turning activity mail off keeps the bell but sends nothing', async () => {
    const defaults = (await h.as('dlevi').get('/notifications/preferences').expect(200)).body;
    expect(defaults).toEqual({ email: await email('dlevi'), mailAlerts: true, mailActivity: true });
    await h.as('dlevi').put('/notifications/preferences').send({ mailActivity: 'no' }).expect(400);
    expect((await h.as('dlevi').put('/notifications/preferences').send({ mailActivity: false }).expect(200)).body).toMatchObject({ mailAlerts: true, mailActivity: false });

    await createSummary(h, 'mgolan', summaryPayload(l, { title: 'שקט בבקשה', taggedUsers: [l.user('dlevi')] }));
    expect((await h.as('dlevi').get('/notifications')).body.some((n: { text: string }) => n.text.includes('שקט בבקשה'))).toBe(true);
    expect(await pass()).toEqual([]);
  });

  it('re-checks access and the address before sending', async () => {
    // control first: dlevi's own request refreshes dlevi's last-known groups
    await createSummary(h, 'dlevi', summaryPayload(l, { title: 'ביקורת', taggedUsers: [l.user('mgolan')] }));
    await createSummary(h, 'mgolan', summaryPayload(l, { title: 'סודי', taggedUsers: [l.user('dlevi')] }));
    await h.sql(`update users set last_group_keys = '{}' where username = 'dlevi'`); // lost cs-faculty since
    await createSummary(h, 'mgolan', summaryPayload(l, { title: 'בלי כתובת', taggedUsers: [l.user('aperetz')] }));
    const aperetz = await email('aperetz');
    await h.sql(`update users set email = null where username = 'aperetz'`);
    try {
      const sent = await pass();
      // mgolan: tagged in "ביקורת", and follows dlevi who published it
      expect(sent.map((m) => m.to)).toEqual([await email('mgolan'), await email('mgolan')]);
      expect(sent.every((m) => m.subject.includes('ביקורת'))).toBe(true);
    } finally {
      await h.sql(`update users set last_group_keys = '{cs-faculty,year-1}' where username = 'dlevi'`);
      await h.sql(`update users set email = $1 where username = 'aperetz'`, [aperetz]);
    }
  });

  it('rules: immediate mail per rule, under the alerts switch', async () => {
    await addRule('dlevi', { name: 'ינשופים', conditions: [text('ינשוף')], isMail: true });
    await addRule('aperetz', { name: 'ינשופים בשקט', conditions: [text('ינשוף')] });

    await createSummary(h, 'mgolan', summaryPayload(l, { title: 'ינשוף' }));
    const sent = await pass();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: await email('dlevi') });
    expect(sent[0].subject).toContain('ינשופים');

    await h.as('dlevi').put('/notifications/preferences').send({ mailAlerts: false }).expect(200);
    await createSummary(h, 'mgolan', summaryPayload(l, { title: 'ינשוף שני' }));
    expect(await pass()).toEqual([]);
    expect((await h.as('dlevi').get('/notifications')).body.filter((n: { text: string }) => n.text.includes('ינשוף שני'))).toHaveLength(1);
  });

  it('daily digest: one mail per user after the digest hour, grouped by rule, sent once', async () => {
    const rule = await addRule('dlevi', { name: 'עצים', conditions: [text('עץ')], isDigest: true });
    expect(rule).toMatchObject({ isDigest: true, isMail: false, isNotify: true });
    await addRule('dlevi', { name: 'יערות', conditions: [text('יער')], isDigest: true });
    const { body: a } = await createSummary(h, 'mgolan', summaryPayload(l, { title: 'עץ אדום-שחור' }));
    await createSummary(h, 'mgolan', summaryPayload(l, { title: 'עץ B' }));
    await createSummary(h, 'mgolan', summaryPayload(l, { title: 'יער פורש' }));

    expect(await pass()).toEqual([]); // nothing immediate, digest not due yet
    const sent = await pass(tomorrowNoon());
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(await email('dlevi'));
    expect(sent[0].subject).toContain('3 תמציות');
    for (const s of ['עצים', 'יערות', 'עץ אדום-שחור', 'עץ B', 'יער פורש']) expect(sent[0].html).toContain(s);
    expect(sent[0].html).toContain(`summaryId=${a._id}`);
    expect(await pass(tomorrowNoon())).toEqual([]);
  });

  it('daily digest: skips rules paused or deleted since the match', async () => {
    const paused = await addRule('dlevi', { name: 'מושהה', conditions: [text('ענן')], isDigest: true });
    const deleted = await addRule('dlevi', { name: 'נמחק', conditions: [text('ענן')], isDigest: true });
    await addRule('aperetz', { name: 'עננים פעיל', conditions: [text('ענן')], isDigest: true }); // control
    await createSummary(h, 'mgolan', summaryPayload(l, { title: 'ענן' }));
    await h.as('dlevi').put('/notifications').send({ ...paused, isNotify: false }).expect(200);
    await h.as('dlevi').delete(`/notifications/${deleted._id}`).expect(200);
    const sent = await pass(tomorrowNoon());
    expect(sent.map((m) => m.to)).toEqual([await email('aperetz')]);
    expect(sent[0].html).toContain('עננים פעיל');
  });

  it('a follower whose rule also matches gets one notification: the activity mail now, the rule in the digest', async () => {
    // seed: mgolan follows dlevi
    await addRule('mgolan', { name: 'צפרות', conditions: [text('ציפור')], isDigest: true });
    await createSummary(h, 'dlevi', summaryPayload(l, { title: 'ציפור שיר' }));
    expect((await h.as('mgolan').get('/notifications')).body.filter((n: { text: string }) => n.text.includes('ציפור שיר'))).toHaveLength(1);

    const now = await pass();
    expect(now).toHaveLength(1);
    expect(now[0].subject).toContain('פרסם/ה תמצית חדשה');
    const digest = await pass(tomorrowNoon());
    expect(digest).toHaveLength(1);
    expect(digest[0].html).toContain('צפרות');
  });

  it('retries a failed delivery on the next pass', async () => {
    await createSummary(h, 'mgolan', summaryPayload(l, { title: 'נסיון חוזר', taggedUsers: [l.user('dlevi')] }));
    const spy = jest.spyOn(mailer, 'send').mockRejectedValueOnce(new Error('smtp down'));
    try {
      expect(await pass()).toEqual([]);
      const sent = await pass();
      expect(sent).toHaveLength(1);
      expect(sent[0].subject).toContain('נסיון חוזר');
    } finally {
      spy.mockRestore();
    }
  });
});
