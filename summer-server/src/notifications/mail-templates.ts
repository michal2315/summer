import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { escapeHtml } from '../common/html';
import { MailMessage } from './mailer';

/** Works from both src/notifications (ts-node) and dist/notifications (build): the folder sits at the project root. */
export const MAIL_DIR = join(__dirname, '..', '..', 'mail');
/** Attached inline to every mail; the layout shows it as cid:summer-logo. */
export const MAIL_LOGO = { filename: 'summer-logo.png', path: join(MAIL_DIR, 'summer-logo.png'), cid: 'summer-logo' };

const templates = new Map<string, string>();
/** mail/<name>.html without its leading comment, read once. */
const template = (name: 'layout' | 'summary-card' | 'comment') => {
  if (!templates.has(name)) templates.set(name, readFileSync(join(MAIL_DIR, `${name}.html`), 'utf8').replace(/<!--[\s\S]*?-->\s*/, ''));
  return templates.get(name)!;
};

/** `{{name}}` is escaped, `{{{name}}}` is inserted as is. An unknown name throws, so a typo never ships. */
export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\{?)\s*(\w+)\s*\}?\}\}/g, (_, raw: string, name: string) => {
    if (!(name in vars)) throw new Error(`mail template: no value for {{${name}}}`);
    return raw ? vars[name] : escapeHtml(vars[name]);
  });
}

/** Where links point and how dates read. */
export interface MailContext {
  appUrl: string;
  timezone: string;
}

export interface MailSummary {
  contentType: string | null;
  author: string | null;
  eventDate: Date | null;
  eventHasTime: boolean;
  labels: string[];
  contentText: string;
}

export interface MailItem {
  text: string;
  summaryId: string | null;
  summaryTitle: string | null;
  summary?: MailSummary | null;
  comment?: string | null;
  actorName?: string | null;
}

export interface DigestGroup {
  ruleName: string;
  items: MailItem[];
}

const EXCERPT = 220;

const summaryUrl = (appUrl: string, id: string) => `${appUrl}/summaries?summaryId=${encodeURIComponent(id)}`;
const settingsUrl = (appUrl: string) => `${appUrl}/notifications`;
const textFooter = (appUrl: string) => `\n\n--\nSummer: ${appUrl}\nלבחירת המיילים שמגיעים אליך: ${settingsUrl(appUrl)}`;
const shorten = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

function formatDate(d: Date, withTime: boolean, timeZone: string): string {
  return new Intl.DateTimeFormat('he-IL', { timeZone, day: 'numeric', month: 'long', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(d);
}

/** "הרצאה · מאת מיכל גולן · 15 במרץ 2026" */
function metaLine(s: MailSummary, timeZone: string): string {
  return [s.contentType, s.author && `מאת ${s.author}`, s.eventDate && formatDate(s.eventDate, s.eventHasTime, timeZone)].filter(Boolean).join(' · ');
}

const labelChips = (labels: string[]) =>
  labels.length
    ? `<div style="margin-top:6px;">${labels
        .slice(0, 8)
        .map((l) => `<span style="display:inline-block;margin:0 0 4px 6px;padding:2px 8px;border-radius:999px;background-color:#ffdfe4;color:#e8253d;font-size:12px;">#${escapeHtml(l)}</span>`)
        .join('')}</div>`
    : '';

function summaryCard(ctx: MailContext, item: MailItem): string {
  if (!item.summaryId || !item.summary) return '';
  return render(template('summary-card'), {
    url: summaryUrl(ctx.appUrl, item.summaryId),
    title: item.summaryTitle ?? '',
    meta: metaLine(item.summary, ctx.timezone),
    labels: labelChips(item.summary.labels),
    excerpt: shorten(item.summary.contentText, EXCERPT),
  });
}

const commentQuote = (item: MailItem) => (item.comment ? render(template('comment'), { author: item.actorName ?? '', comment: shorten(item.comment, 600) }) : '');

function page(ctx: MailContext, v: { preheader: string; title: string; body: string; ctaUrl: string; ctaLabel: string }): string {
  return render(template('layout'), { ...v, appUrl: ctx.appUrl, settingsUrl: settingsUrl(ctx.appUrl) });
}

/** One notification, sent right away: what happened, the comment if any, and the summary. */
export function notificationMail(ctx: MailContext, to: string, item: MailItem): MailMessage {
  const link = item.summaryId ? summaryUrl(ctx.appUrl, item.summaryId) : ctx.appUrl;
  const s = item.summary;
  const text = [
    item.text,
    item.comment && `\n"${shorten(item.comment, 600)}"`,
    item.summaryTitle && `\n${item.summaryTitle}${s ? `\n${metaLine(s, ctx.timezone)}` : ''}`,
    s?.contentText && shorten(s.contentText, EXCERPT),
    `\n${link}`,
  ]
    .filter(Boolean)
    .join('\n');
  return {
    to,
    subject: `Summer: ${shorten(item.text, 140)}`,
    html: page(ctx, {
      preheader: item.comment ? shorten(item.comment, 120) : (item.summaryTitle ?? item.text),
      title: item.text,
      body: commentQuote(item) + summaryCard(ctx, item),
      ctaUrl: link,
      ctaLabel: item.summaryId ? 'לצפייה בתמצית' : 'כניסה ל-Summer',
    }),
    text: text + textFooter(ctx.appUrl),
  };
}

/** The day's rule matches, grouped by rule; each item shows its type, author and date. */
export function digestMail(ctx: MailContext, to: string, groups: DigestGroup[]): MailMessage {
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  const title = count === 1 ? 'תמצית אחת חדשה תואמת להתראות שלך' : `${count} תמציות חדשות תואמות להתראות שלך`;
  const itemHtml = (i: MailItem) => {
    const label = escapeHtml(i.summaryTitle ?? i.text);
    const link = i.summaryId ? `<a href="${escapeHtml(summaryUrl(ctx.appUrl, i.summaryId))}" style="color:#e8253d;text-decoration:none;font-weight:bold;">${label}</a>` : label;
    const meta = i.summary ? metaLine(i.summary, ctx.timezone) : '';
    const excerpt = i.summary?.contentText ? shorten(i.summary.contentText, 140) : '';
    return (
      `<li style="margin:0 0 10px 0;">${link}` +
      (meta ? `<div style="font-size:12px;color:#6b6b80;">${escapeHtml(meta)}</div>` : '') +
      (excerpt ? `<div style="font-size:13px;color:#3a3a55;">${escapeHtml(excerpt)}</div>` : '') +
      `</li>`
    );
  };
  const body = groups
    .map(
      (g) =>
        `<div style="margin:16px 0 6px 0;font-size:13px;font-weight:bold;color:#6b6b80;">לפי הכלל: ${escapeHtml(g.ruleName)}</div>` +
        `<ul style="margin:0;padding:0 20px 0 0;">${g.items.map(itemHtml).join('')}</ul>`,
    )
    .join('');
  const text = groups
    .map(
      (g) =>
        `לפי הכלל: ${g.ruleName}\n${g.items
          .map((i) => `- ${i.summaryTitle ?? i.text}${i.summary ? ` (${metaLine(i.summary, ctx.timezone)})` : ''}${i.summaryId ? `\n  ${summaryUrl(ctx.appUrl, i.summaryId)}` : ''}`)
          .join('\n')}`,
    )
    .join('\n\n');
  return {
    to,
    subject: `Summer · סיכום יומי: ${title}`,
    html: page(ctx, { preheader: groups.map((g) => g.ruleName).join(', '), title, body, ctaUrl: `${ctx.appUrl}/summaries`, ctaLabel: 'לכל התמציות' }),
    text: `${title}\n\n${text}${textFooter(ctx.appUrl)}`,
  };
}
