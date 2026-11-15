import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { Me } from '../auth/auth.guard';
import { CurrentUser } from '../auth/identity-provider';
import { ApiQuery } from '../common/api-types';
import { IdPipe } from '../common/validation';
import { QueriesService } from './queries.service';

/**
 * The caller's queries (saved searches) and their alerts.
 * GET/POST /queries · PUT/DELETE /queries/:id · PUT/DELETE /queries/:id/alert
 */
@Controller('queries')
export class QueriesController {
  constructor(private readonly queries: QueriesService) {}

  @Get()
  list(@Me() me: CurrentUser): Promise<ApiQuery[]> {
    return this.queries.list(me);
  }

  @Post()
  create(@Me() me: CurrentUser, @Body() body: unknown): Promise<ApiQuery> {
    return this.queries.create(me, body);
  }

  @Put(':id')
  update(@Me() me: CurrentUser, @Param('id', IdPipe) id: string, @Body() body: unknown): Promise<ApiQuery> {
    return this.queries.update(me, id, body);
  }

  @Delete(':id')
  async remove(@Me() me: CurrentUser, @Param('id', IdPipe) id: string): Promise<object> {
    await this.queries.remove(me, id);
    return {};
  }

  @Put(':id/alert')
  setAlert(@Me() me: CurrentUser, @Param('id', IdPipe) id: string, @Body() body: unknown): Promise<ApiQuery> {
    return this.queries.setAlert(me, id, body);
  }

  @Delete(':id/alert')
  removeAlert(@Me() me: CurrentUser, @Param('id', IdPipe) id: string): Promise<ApiQuery> {
    return this.queries.removeAlert(me, id);
  }
}
