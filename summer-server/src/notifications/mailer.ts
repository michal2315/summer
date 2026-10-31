import { Logger } from '@nestjs/common';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTransport } from 'nodemailer';
import { AppConfig } from '../config/app-config';
import { MAIL_LOGO } from './mail-templates';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Sends one e-mail; throws when delivery fails so the caller can retry. */
export abstract class Mailer {
  abstract send(message: MailMessage): Promise<void>;
}

export class SmtpMailer extends Mailer {
  private readonly transport;

  constructor(
    url: string,
    private readonly from: string,
  ) {
    super();
    this.transport = createTransport(url);
  }

  async send(m: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, to: m.to, subject: m.subject, html: m.html, text: m.text, attachments: [MAIL_LOGO] });
  }
}

export interface GraphCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

/**
 * Microsoft Graph sendMail as \`from.address\`, with an app-only token (client credentials; the Entra app needs the
 * Mail.Send application permission). Microsoft delivers it, so it works from any network and passes SPF/DKIM.
 */
export class GraphMailer extends Mailer {
  private token?: { value: string; expiresAt: number };
  private logo?: string;

  constructor(
    private readonly credentials: GraphCredentials,
    private readonly from: { address: string; name: string },
  ) {
    super();
  }

  async send(m: MailMessage): Promise<void> {
    this.logo ??= readFileSync(MAIL_LOGO.path).toString('base64');
    const message = {
      subject: m.subject,
      body: { contentType: 'HTML', content: m.html },
      toRecipients: [{ emailAddress: { address: m.to } }],
      from: { emailAddress: { address: this.from.address, name: this.from.name || undefined } },
      attachments: [
        {
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: MAIL_LOGO.filename,
          contentType: 'image/png',
          contentBytes: this.logo,
          contentId: MAIL_LOGO.cid,
          isInline: true,
        },
      ],
    };
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.from.address)}/sendMail`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message, saveToSentItems: false }),
    });
    if (res.status === 401) this.token = undefined;
    if (!res.ok) throw new Error(`Graph sendMail ${res.status}: ${await errorText(res)}`);
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    const { tenantId, clientId, clientSecret } = this.credentials;
    const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
    });
    if (!res.ok) throw new Error(`Graph token ${res.status}: ${await errorText(res)}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    // Renew a minute early so a token never expires mid-request.
    this.token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
    return this.token.value;
  }
}

/** The error message Graph/Entra put in their JSON, without echoing anything we sent. */
async function errorText(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const j = JSON.parse(text) as { error?: { code?: string; message?: string } | string; error_description?: string };
    if (typeof j.error === 'object') return `${j.error.code}: ${j.error.message}`;
    return `${j.error}: ${(j.error_description ?? '').split('\n')[0]}`;
  } catch {
    return text.slice(0, 300);
  }
}

/** Dev/test: logs each mail, keeps the latest in `sent`, and with a preview dir writes each as an .html file to open. */
export class LogMailer extends Mailer {
  private readonly logger = new Logger('Mail');
  readonly sent: MailMessage[] = [];

  constructor(private readonly previewDir = '') {
    super();
  }

  async send(m: MailMessage): Promise<void> {
    this.sent.push(m);
    if (this.sent.length > 200) this.sent.shift();
    this.logger.log(`to ${m.to}: ${m.subject}\n${m.text}`);
    if (!this.previewDir) return;
    mkdirSync(this.previewDir, { recursive: true });
    const file = join(this.previewDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${m.to.replace(/[^\w.@-]/g, '_')}.html`);
    writeFileSync(file, m.html.replace(`cid:${MAIL_LOGO.cid}`, pathToFileURL(resolve(MAIL_LOGO.path)).href));
    this.logger.log(`preview: ${resolve(file)}`);
  }
}

/** Sends every mail to one address instead (testing on real data); the subject keeps the intended recipient. */
export class RedirectMailer extends Mailer {
  constructor(
    private readonly inner: Mailer,
    private readonly to: string,
  ) {
    super();
  }

  send(m: MailMessage): Promise<void> {
    return this.inner.send({ ...m, to: this.to, subject: `[ל: ${m.to}] ${m.subject}`, text: `(נשלח במקום אל ${m.to})\n\n${m.text}` });
  }
}

export function createMailer(config: AppConfig): Mailer {
  const { mail } = config;
  const mailer =
    mail.transport === 'graph'
      ? new GraphMailer(mail.graph, { address: mail.fromAddress, name: mail.fromName })
      : mail.transport === 'smtp'
        ? new SmtpMailer(mail.smtpUrl, mail.from)
        : new LogMailer(mail.previewDir);
  return mail.redirectTo ? new RedirectMailer(mailer, mail.redirectTo) : mailer;
}
