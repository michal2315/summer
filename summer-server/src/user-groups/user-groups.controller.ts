import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Me } from '../auth/auth.guard';
import { CurrentUser } from '../auth/identity-provider';
import { ApiUserGroup } from '../common/api-types';
import { IdPipe } from '../common/validation';
import { UserGroupsService } from './user-groups.service';

/**
 * User groups: users and permission groups tagged together.
 * GET/POST /user-groups · GET /user-groups/shared · POST /user-groups/:id/copy · PUT/DELETE /user-groups/:id
 */
@Controller('user-groups')
export class UserGroupsController {
  constructor(private readonly groups: UserGroupsService) {}

  @Get()
  list(@Me() me: CurrentUser): Promise<ApiUserGroup[]> {
    return this.groups.list(me);
  }

  @Get('shared')
  shared(@Me() me: CurrentUser, @Query() query: unknown): Promise<ApiUserGroup[]> {
    return this.groups.shared(me, query);
  }

  @Post()
  create(@Me() me: CurrentUser, @Body() body: unknown): Promise<ApiUserGroup> {
    return this.groups.create(me, body);
  }

  @Post(':id/copy')
  copy(@Me() me: CurrentUser, @Param('id', IdPipe) id: string, @Body() body: unknown): Promise<ApiUserGroup> {
    return this.groups.copy(me, id, body);
  }

  @Put(':id')
  update(@Me() me: CurrentUser, @Param('id', IdPipe) id: string, @Body() body: unknown): Promise<ApiUserGroup> {
    return this.groups.update(me, id, body);
  }

  @Delete(':id')
  async remove(@Me() me: CurrentUser, @Param('id', IdPipe) id: string): Promise<object> {
    await this.groups.remove(me, id);
    return {};
  }
}
