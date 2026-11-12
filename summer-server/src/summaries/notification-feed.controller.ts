import { Controller, Get, Query } from '@nestjs/common';
import { Me } from '../auth/auth.guard';
import { CurrentUser } from '../auth/identity-provider';
import { ApiNotificationFeedItem } from '../common/api-types';
import { unique } from '../common/validation';
import { NotificationsService } from '../notifications/notifications.service';
import { SummariesService } from './summaries.service';

/**
 * GET /notifications/feed?ruleId=&offset= — the notifications page: each notification with its summary.
 * Lives here, not in NotificationsController, because hydrating summaries needs SummariesService
 * (and SummariesModule already depends on NotificationsModule).
 */
@Controller('notifications')
export class NotificationFeedController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly summaries: SummariesService,
  ) {}

  @Get('feed')
  async feed(@Me() me: CurrentUser, @Query() query: unknown): Promise<{ items: ApiNotificationFeedItem[]; hasMore: boolean }> {
    const page = await this.notifications.feed(me, query);
    // The feed query already kept only summaries the caller can see.
    const summaries = await this.summaries.hydrate(me, unique(page.items.map((n) => n.summaryId!)));
    const byId = new Map(summaries.map((s) => [s._id, s]));
    return {
      hasMore: page.hasMore,
      items: page.items.flatMap((n) => {
        const summary = byId.get(n.summaryId!);
        return summary ? [{ ...n, summary }] : [];
      }),
    };
  }
}
