import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Me } from '../auth/auth.guard';
import { CurrentUser } from '../auth/identity-provider';
import { ApiQuery } from '../common/api-types';
import { IdPipe } from '../common/validation';
import { QueriesService } from './queries.service';

/**
 * Queries (saved searches) and the caller's alerts on them.
 * GET/POST /queries · GET /queries/shared · GET/PUT/DELETE /queries/:id · POST /queries/:id/copy · PUT/DELETE /queries/:id/alert
 */
@Controller('queries')
export class QueriesController {
  constructor(private readonly queries: QueriesService) {}

  @Get()
  list(@Me() me: CurrentUser): Promise<ApiQuery[]> {
    return this.queries.list(me);
  }

  @Get('shared')
  shared(@Me() me: CurrentUser, @Query() query: unknown): Promise<ApiQuery[]> {
    return this.queries.shared(me, query);
  }

  /** Declared after `shared` so that path isn't taken for an id. */
  @Get(':id')
  one(@Me() me: CurrentUser, @Param('id', IdPipe) id: string): Promise<ApiQuery> {
    return this.queries.get(me, id);
  }

  @Post()
  create(@Me() me: CurrentUser, @Body() body: unknown): Promise<ApiQuery> {
    return this.queries.create(me, body);
  }

  @Post(':id/copy')
  copy(@Me() me: CurrentUser, @Param('id', IdPipe) id: string, @Body() body: unknown): Promise<ApiQuery> {
    return this.queries.copy(me, id, body);
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
