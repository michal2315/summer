import { digestMail, notificationMail, render } from './mail-templates';
import { LogMailer, RedirectMailer } from './mailer';

const ctx = { appUrl: 'http://localhost:81', timezone: 'Asia/Jerusalem' };
const summary = {
  contentType: 'הרצאה',
  author: 'מיכל גולן',
  eventDate: new Date('2026-03-15T07:30:00Z'),
  eventHasTime: true,
  labels: ['עצים', 'אלגוריתמים'],
  contentText: 'עץ AVL הוא עץ חיפוש בינארי מאוזן. '.repeat(20),
};

describe('mail templates', () => {
  it('escapes {{x}}, inserts {{{x}}} as is, and refuses unknown names', () => {
    expect(render('<b>{{a}}</b>{{{b}}}', { a: '<i>&', b: '<i>ok</i>' })).toBe('<b>&lt;i&gt;&amp;</b><i>ok</i>');
    expect(() => render('{{missing}}', {})).toThrow('missing');
  });

  it('fills the Summer layout: logo, RTL, link back to the summary and to the settings', () => {
    const m = notificationMail(ctx, 'a@b.c', { text: 'דנה תייג/ה אותך <script>', summaryId: 's1', summaryTitle: 'גרפים' });
    expect(m.html).toContain('dir="rtl"');
    expect(m.html).toContain('src="cid:summer-logo"');
    expect(m.html).toContain('href="http://localhost:81/summaries?summaryId=s1"');
    expect(m.html).toContain('href="http://localhost:81/notifications"');
    expect(m.html).toContain('&lt;script&gt;');
    expect(m.html).not.toMatch(/\{\{|<!--/);
    expect(m.text).toContain('http://localhost:81/summaries?summaryId=s1');
  });

  it('details: the comment quoted, and a summary card with type, author, date, labels and an excerpt', () => {
    const m = notificationMail(ctx, 'a@b.c', {
      text: 'מיכל גולן הזכיר/ה אותך בתגובה',
      summaryId: 's1',
      summaryTitle: 'עצי AVL',
      summary,
      comment: 'דנה, תסתכלי על <b>הסיבובים</b>',
      actorName: 'מיכל גולן',
    });
    expect(m.html).toContain('מיכל גולן כתב/ה:');
    expect(m.html).toContain('דנה, תסתכלי על &lt;b&gt;הסיבובים&lt;/b&gt;');
    expect(m.html).toContain('הרצאה · מאת מיכל גולן · 15 במרץ 2026');
    expect(m.html).toContain('#עצים');
    expect(m.html).toContain('…'); // excerpt shortened
    expect(m.html).not.toMatch(/\{\{|<!--/);
    expect(m.text).toContain('"דנה, תסתכלי על <b>הסיבובים</b>"');
    expect(m.text).toContain('הרצאה · מאת מיכל גולן');
  });

  it('digest lists each rule with its summaries and their details', () => {
    const m = digestMail(ctx, 'a@b.c', [{ ruleName: 'עצים', items: [{ text: 't', summaryId: 's1', summaryTitle: 'עץ AVL', summary }] }]);
    expect(m.subject).toContain('תמצית אחת');
    expect(m.html).toContain('לפי הכלל: עצים');
    expect(m.html).toContain('>עץ AVL</a>');
    expect(m.html).toContain('מאת מיכל גולן');
  });

  it('redirect sends everything to one address and keeps the intended recipient in the subject', async () => {
    const log = new LogMailer();
    await new RedirectMailer(log, 'me@test.dev').send({ to: 'dlevi@x', subject: 'שלום', html: '', text: 'גוף' });
    expect(log.sent[0]).toMatchObject({ to: 'me@test.dev', subject: '[ל: dlevi@x] שלום' });
    expect(log.sent[0].text).toContain('dlevi@x');
  });
});
