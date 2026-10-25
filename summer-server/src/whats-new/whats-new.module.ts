import { BadRequestException, Body, Controller, Get, Injectable, Module, Post } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { Me } from '../auth/auth.guard';
import { CurrentUser } from '../auth/identity-provider';
import { parse } from '../common/validation';
import { DatabaseService } from '../database/database.service';
import { whatsNewSeen } from '../database/schema';

/**
 * Releases are defined in code (stable keys); only per-user "seen" state is stored. The release notes HTML is
 * served by the client from public/whats-new/<version>.html — add a version here when adding a file there.
 */
export const RELEASES = [{ version: '2.0.0', date: '2026-10-23' }];

@Injectable()
export class WhatsNewRepository {
  constructor(private readonly database: DatabaseService) {}

  async seenVersions(userId: string): Promise<Set<string>> {
    const rows = await this.database.db.select({ v: whatsNewSeen.version }).from(whatsNewSeen).where(eq(whatsNewSeen.userId, userId));
    return new Set(rows.map((r) => r.v));
  }

  async markSeen(userId: string, version: string): Promise<void> {
    await this.database.db.insert(whatsNewSeen).values({ userId, version }).onConflictDoNothing();
  }
}

const ackBody = z.object({ version: z.string().max(50) });

@Controller('whats-new')
export class WhatsNewController {
  constructor(private readonly repo: WhatsNewRepository) {}

  @Get()
  async list(@Me() me: CurrentUser) {
    const seen = await this.repo.seenVersions(me.id);
    return RELEASES.map((r) => ({ ...r, isAcknowledged: seen.has(r.version) }));
  }

  @Post('acknowledge')
  async acknowledge(@Me() me: CurrentUser, @Body() body: unknown): Promise<object> {
    const { version } = parse(ackBody, body);
    if (!RELEASES.some((r) => r.version === version)) throw new BadRequestException('unknown version');
    await this.repo.markSeen(me.id, version);
    return {};
  }
}

@Module({
  controllers: [WhatsNewController],
  providers: [WhatsNewRepository],
})
export class WhatsNewModule {}
