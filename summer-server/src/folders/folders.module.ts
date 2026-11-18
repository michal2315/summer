import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module';
import { SummariesModule } from '../summaries/summaries.module';
import { UsersModule } from '../users/users.module';
import { FoldersController } from './folders.controller';
import { FoldersRepository } from './folders.repository';
import { FoldersService } from './folders.service';
import { LegacyController } from './legacy.controller';
import { LegacyDemoService } from './legacy-demo.service';
import { LegacyRepository } from './legacy.repository';
import { LegacyService } from './legacy.service';

@Module({
  imports: [SummariesModule, PermissionsModule, UsersModule],
  controllers: [FoldersController, LegacyController],
  providers: [FoldersRepository, FoldersService, LegacyRepository, LegacyService, LegacyDemoService],
  exports: [LegacyRepository],
})
export class FoldersModule {}
