import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { Me } from '../auth/auth.guard';
import { CurrentUser } from '../auth/identity-provider';
import { ApiNotification } from '../common/api-types';
import { IdPipe } from '../common/validation';
import { ApiRule, NotificationsService } from './notifications.service';

/**
 * The client shares one prefix between the bell inbox and notification rules:
 * POST/PUT/DELETE /notifications[/:id] manage the caller's rules; GET /notifications is the inbox.
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

  @Get('settings')
  rules(@Me() me: CurrentUser): Promise<ApiRule[]> {
    return this.notifications.rules(me);
  }

  @Post()
  createRule(@Me() me: CurrentUser, @Body() body: unknown): Promise<ApiRule> {
    return this.notifications.saveRule(me, body, 'create');
  }

  @Put()
  updateRule(@Me() me: CurrentUser, @Body() body: unknown): Promise<ApiRule> {
    return this.notifications.saveRule(me, body, 'update');
  }

  @Delete(':id')
  async deleteRule(@Me() me: CurrentUser, @Param('id', IdPipe) id: string): Promise<object> {
    await this.notifications.deleteRule(me, id);
    return {};
  }
}
