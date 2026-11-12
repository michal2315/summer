import { Body, Controller, Delete, Get, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { Me } from '../auth/auth.guard';
import { CurrentUser } from '../auth/identity-provider';
import { ApiBulkResult, ApiSummaryTemplate, ApiUser, UserRef } from '../common/api-types';
import { IdPipe, isUuid } from '../common/validation';
import { SummaryTemplatesService } from './summary-templates.service';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

type Body_ = Record<string, unknown> | undefined;

// Route order matters: literal segments are declared before `:username`.
@Controller('user')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly repo: UsersRepository,
    private readonly templates: SummaryTemplatesService,
  ) {}

  @Get()
  me(@Me() me: CurrentUser): Promise<ApiUser> {
    return this.users.me(me);
  }

  @Get('ids')
  byIds(@Query('_ids') ids = ''): Promise<UserRef[]> {
    return this.repo.refsByIds(
      String(ids)
        .split(',')
        .filter(isUuid)
        .slice(0, 200),
    );
  }

  @Get('query/:prefix')
  query(@Param('prefix') prefix: string): Promise<UserRef[]> {
    return this.repo.search(prefix.slice(0, 100), true);
  }

  @Get('name/:text')
  byName(@Param('text') text: string): Promise<UserRef[]> {
    return this.repo.search(text.slice(0, 100), false);
  }

  @Get('pinned-search')
  pinnedSearches(@Me() me: CurrentUser): Promise<ApiUser> {
    return this.users.me(me);
  }

  @Post('pinned-search')
  pinSearch(@Me() me: CurrentUser, @Body() body: unknown): Promise<ApiUser> {
    return this.users.pinSearch(me, body);
  }

  @Put('pinned-search/:id')
  updateSearch(@Me() me: CurrentUser, @Param('id', IdPipe) id: string, @Body() body: Body_): Promise<ApiUser> {
    return this.users.updateSearch(me, id, body);
  }

  @Post('pinned-label')
  pinLabel(@Me() me: CurrentUser, @Body() body: Body_): Promise<ApiUser> {
    return this.users.toggleLabel(me, 'pinned', body?.label);
  }

  @Post('pinned-permission')
  pinPermission(@Me() me: CurrentUser, @Body() body: Body_): Promise<ApiUser> {
    return this.users.togglePinnedPermission(me, body?.permissionId);
  }

  @Post('pinned-user')
  pinUser(@Me() me: CurrentUser, @Body() body: Body_): Promise<ApiUser> {
    return this.users.togglePinnedUser(me, body?.userId);
  }

  @Post('favorite-label')
  favoriteLabel(@Me() me: CurrentUser, @Body() body: Body_): Promise<ApiUser> {
    return this.users.toggleLabel(me, 'favorite', body?.valueId);
  }

  /** IUser has no favourite-permissions list, so there is nothing to store (kept for client compatibility). */
  @Post('favorite-permission')
  favoritePermission(@Me() me: CurrentUser): Promise<ApiUser> {
    return this.users.me(me);
  }

  @Put('favorite')
  favoriteSummary(@Me() me: CurrentUser, @Body() body: Body_): Promise<ApiUser> {
    return this.users.toggleFavoriteSummary(me, body?.summaryId);
  }

  /** `{ summaryIds, favorite }` → which summaries changed and which were skipped. */
  @Post('favorite/bulk')
  bulkFavorite(@Me() me: CurrentUser, @Body() body: unknown): Promise<ApiBulkResult> {
    return this.users.bulkFavorite(me, body);
  }

  @Get('templates')
  summaryTemplates(@Me() me: CurrentUser): Promise<ApiSummaryTemplate[]> {
    return this.templates.list(me);
  }

  @Post('templates')
  saveSummaryTemplate(@Me() me: CurrentUser, @Body() body: unknown): Promise<ApiSummaryTemplate[]> {
    return this.templates.save(me, body);
  }

  @Delete('templates/:id')
  deleteSummaryTemplate(@Me() me: CurrentUser, @Param('id', IdPipe) id: string): Promise<ApiSummaryTemplate[]> {
    return this.templates.delete(me, id);
  }

  @Put('add-follow/:userId')
  follow(@Me() me: CurrentUser, @Param('userId', IdPipe) userId: string): Promise<ApiUser> {
    return this.users.follow(me, userId);
  }

  @Delete('remove-follow/:userId')
  unfollow(@Me() me: CurrentUser, @Param('userId', IdPipe) userId: string): Promise<ApiUser> {
    return this.users.unfollow(me, userId);
  }

  @Get(':username')
  async byUsername(@Param('username') username: string): Promise<UserRef> {
    const user = await this.repo.refByUsername(username);
    if (!user) throw new NotFoundException();
    return user;
  }
}
