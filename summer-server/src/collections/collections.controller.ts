import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { Me } from '../auth/auth.guard';
import { CurrentUser } from '../auth/identity-provider';
import { ApiBulkResult, ApiCollection, ApiCollectionRef, ApiSummary, SummaryLengths } from '../common/api-types';
import { IdPipe, isUuid } from '../common/validation';
import { SummariesService } from '../summaries/summaries.service';
import { CollectionsService } from './collections.service';

// Route order matters: literal segments are declared before `:id`.
@Controller('collection')
export class CollectionsController {
  constructor(
    private readonly collections: CollectionsService,
    private readonly summaries: SummariesService,
  ) {}

  @Get('ids')
  byIds(@Me() me: CurrentUser, @Query('_ids') ids = ''): Promise<ApiCollectionRef[]> {
    return this.collections.refsByIds(
      me,
      String(ids)
        .split(',')
        .filter(isUuid)
        .slice(0, 200),
    );
  }

  @Get('collectionName/:text')
  byName(@Me() me: CurrentUser, @Param('text') text: string): Promise<ApiCollectionRef[]> {
    return this.collections.refsByName(me, text.slice(0, 120));
  }

  /** The caller's view of collections (`:userId` is legacy; results are always scoped to the caller). */
  @Get('user/:userId')
  list(@Me() me: CurrentUser, @Query() query: unknown): Promise<ApiCollection[]> {
    return this.collections.list(me, query);
  }

  @Get('summaries/:id')
  summariesOf(@Me() me: CurrentUser, @Param('id', IdPipe) id: string, @Query() query: unknown): Promise<{ summaries: ApiSummary[]; lengths: SummaryLengths }> {
    return this.collections.summariesOf(me, id, this.summaries.parseSearch(query));
  }

  @Post('create')
  create(@Me() me: CurrentUser, @Body() body: unknown): Promise<ApiCollection> {
    return this.collections.create(me, body);
  }

  @Post('edit/:id')
  edit(@Me() me: CurrentUser, @Param('id', IdPipe) id: string, @Body() body: unknown): Promise<ApiCollection> {
    return this.collections.edit(me, id, body);
  }

  @Post('add')
  add(@Me() me: CurrentUser, @Body() body: unknown): Promise<ApiBulkResult> {
    return this.collections.addSummaries(me, body);
  }

  /** `{ collectionIds, summaryIds }` → which collections changed and which were skipped. */
  @Post('remove')
  removeSummaries(@Me() me: CurrentUser, @Body() body: unknown): Promise<ApiBulkResult> {
    return this.collections.removeSummaries(me, body);
  }

  @Delete(':id')
  async remove(@Me() me: CurrentUser, @Param('id', IdPipe) id: string): Promise<object> {
    await this.collections.delete(me, id);
    return {};
  }

  @Get(':id')
  get(@Me() me: CurrentUser, @Param('id', IdPipe) id: string): Promise<ApiCollection> {
    return this.collections.get(me, id);
  }
}
