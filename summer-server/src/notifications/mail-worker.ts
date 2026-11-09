import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { zonedDate, zonedTimeToUtc } from '../common/time';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DigestGroup, digestMail, notificationMail } from './mail-templates';
import { Mailer } from './mailer';
import { MailRow, NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

const BATCH = 100;
/** A mail that failed this many times is dropped. */
const MAX_ATTEMPTS = 5;

/**
 * Sends the notifications outbox (notifications.mail / .digest) after the transactions that wrote it commit:
 * immediate mails on every pass, and each user's digest once a day after DIGEST_HOUR.
 */
@Injectable()
export class MailWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MailWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly repo: NotificationsRepository,
    private readonly notifications: NotificationsService,
    private readonly mailer: Mailer,
  ) {}

  private get mailContext() {
    return { appUrl: this.config.appUrl, timezone: this.config.timezone };
  }

  onApplicationBootstrap(): void {
    if (this.config.mail.pollMs) this.timer = setInterval(() => void this.tick(), this.config.mail.pollMs);
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  /** One pass. Overlapping calls are skipped. */
  async tick(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sendImmediate();
      await this.sendDigests(now);
    } catch (e) {
      this.logger.error(`mail pass failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async sendImmediate(): Promise<void> {
    for (;;) {
      const rows = await this.repo.claimMail('mail', BATCH);
      const failed: string[] = [];
      for (const r of rows) {
        if (!(await this.deliverable(r))) continue;
        if (!(await this.send(notificationMail(this.mailContext, r.recipient.email!, r), r.recipient.id))) failed.push(...this.retryable([r]));
      }
      await this.repo.requeueMail('mail', failed);
      // A failing transport waits for the next pass instead of spinning on the same rows.
      if (rows.length < BATCH || failed.length) return;
    }
  }

  /** Rule matches created before today's DIGEST_HOUR, one mail per user, once the hour has passed. */
  private async sendDigests(now: Date): Promise<void> {
    const [y, m, d] = zonedDate(now, this.config.timezone);
    const cutoff = zonedTimeToUtc(y, m, d, this.config.mail.digestHour, 0, this.config.timezone);
    if (now < cutoff) return;

    const rows: MailRow[] = [];
    for (;;) {
      const batch = await this.repo.claimMail('digest', BATCH, cutoff);
      rows.push(...batch);
      if (batch.length < BATCH) break;
    }
    const byUser = new Map<string, MailRow[]>();
    for (const r of rows) {
      // The rule may since have been deleted, paused, or taken off the digest; the user may have turned alert mails off.
      if (!r.rule?.isNotify || !r.rule.isDigest || !r.recipient.mailAlerts || !(await this.deliverable(r))) continue;
      byUser.set(r.recipient.id, [...(byUser.get(r.recipient.id) ?? []), r]);
    }
    for (const items of byUser.values()) {
      const groups = new Map<string, DigestGroup>();
      for (const r of items) {
        const g = groups.get(r.rule!.id) ?? { ruleName: r.rule!.name, items: [] };
        g.items.push(r);
        groups.set(r.rule!.id, g);
      }
      const recipient = items[0].recipient;
      if (!(await this.send(digestMail(this.mailContext, recipient.email!, [...groups.values()]), recipient.id)))
        await this.repo.requeueMail('digest', this.retryable(items));
    }
  }

  /** Still has an address, and can still see the summary (by last-known groups). */
  private async deliverable(r: MailRow): Promise<boolean> {
    if (!r.recipient.email) return false;
    return !r.summaryId || this.notifications.canView(r.recipient, r.summaryId);
  }

  private retryable(rows: MailRow[]): string[] {
    return rows.filter((r) => r.mailAttempts + 1 < MAX_ATTEMPTS).map((r) => r.id);
  }

  private async send(message: Parameters<Mailer['send']>[0], userId: string): Promise<boolean> {
    try {
      await this.mailer.send(message);
      return true;
    } catch (e) {
      this.logger.warn(`mail to user ${userId} failed: ${(e as Error).message}`);
      return false;
    }
  }
}
