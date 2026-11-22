import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Me } from '../auth/auth.guard';
import { CurrentUser } from '../auth/identity-provider';
import { IdPipe } from '../common/validation';
import { LegacyDemoService } from './legacy-demo.service';
import { ApiLegacyItem, ApiLegacyMoveResult, ApiLegacyOverview, ApiLegacySearch, LegacyService } from './legacy.service';

/** The staging page: sorting the collections from the old Summer (see LegacyService). */
@Controller('legacy')
export class LegacyController {
  constructor(
    private readonly legacy: LegacyService,
    private readonly demo: LegacyDemoService,
  ) {}

  /** `demo`: the reset-demo button may show (never in production). */
  @Get()
  async overview(@Me() me: CurrentUser): Promise<ApiLegacyOverview & { demo: boolean }> {
    return { ...(await this.legacy.overview(me)), demo: this.demo.enabled };
  }

  /** DEV ONLY: put the demo collections back to the start (see LegacyDemoService). */
  @Post('demo-reset')
  @HttpCode(200)
  async demoReset(): Promise<object> {
    await this.demo.reset();
    return {};
  }

  /** Which summaries in the caller's collections match a search-box text. */
  @Post('search')
  @HttpCode(200)
  search(@Me() me: CurrentUser, @Body() body: unknown): Promise<ApiLegacySearch> {
    return this.legacy.search(me, body);
  }

  @Get(':id/items')
  items(@Me() me: CurrentUser, @Param('id', IdPipe) id: string): Promise<ApiLegacyItem[]> {
    return this.legacy.items(me, id);
  }

  @Post(':id/items/move')
  moveItems(@Me() me: CurrentUser, @Param('id', IdPipe) id: string, @Body() body: unknown): Promise<ApiLegacyMoveResult> {
    return this.legacy.moveItems(me, id, body);
  }

  @Post(':id/items/release')
  releaseItems(@Me() me: CurrentUser, @Param('id', IdPipe) id: string, @Body() body: unknown) {
    return this.legacy.releaseItems(me, id, body);
  }

  @Post(':id/items/restore')
  restoreItems(@Me() me: CurrentUser, @Param('id', IdPipe) id: string, @Body() body: unknown) {
    return this.legacy.restoreItems(me, id, body);
  }

  @Post(':id/restore')
  restoreCollection(@Me() me: CurrentUser, @Param('id', IdPipe) id: string): Promise<object> {
    return this.legacy.restoreCollection(me, id);
  }
}
