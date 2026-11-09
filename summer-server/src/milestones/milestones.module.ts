import { Controller, Get, Module, Param } from '@nestjs/common';
import { IdPipe } from '../common/validation';
import { MilestonesRepository } from './milestones.repository';

@Controller('milestones')
export class MilestonesController {
  constructor(private readonly repo: MilestonesRepository) {}

  /** The ids of the milestones `userId` has earned (definitions and display live in the client). */
  @Get(':userId')
  async earned(@Param('userId', IdPipe) userId: string): Promise<{ earned: string[] }> {
    const flags = await this.repo.flags(userId);
    return { earned: Object.keys(flags).filter((id) => flags[id]) };
  }
}

@Module({
  controllers: [MilestonesController],
  providers: [MilestonesRepository],
})
export class MilestonesModule {}
