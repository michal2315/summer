import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { Me } from '../auth/auth.guard';
import { CurrentUser } from '../auth/identity-provider';
import { ApiNotification } from '../common/api-types';
import { IdPipe } from '../common/validation';
import { MailPreferences } from './notifications.repository';
import { NotificationsService } from './notifications.service';

/**
 * GET /notifications is the bell inbox; GET/PUT /notifications/preferences are the caller's e-mail switches.
 * Alerts live on queries (/queries/:id/alert).
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  inbox(@Me() me: CurrentUser): Promise<ApiNotification[]> {
    return this.notifications.inbox(me);
  }

  @Put('all-viewed')
  async allViewed(@Me() me: CurrentUser): Promise<object> {
    await this.notifications.markViewed(me);
    return {};
  }

  @Put('viewed/:id')
  async viewed(@Me() me: CurrentUser, @Param('id', IdPipe) id: string): Promise<object> {
    await this.notifications.markViewed(me, id);
    return {};
  }

  @Get('preferences')
  preferences(@Me() me: CurrentUser): Promise<MailPreferences> {
    return this.notifications.preferences(me);
  }

  @Put('preferences')
  setPreferences(@Me() me: CurrentUser, @Body() body: unknown): Promise<MailPreferences> {
    return this.notifications.setPreferences(me, body);
  }
}
