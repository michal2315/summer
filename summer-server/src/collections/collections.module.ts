import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module';
import { SummariesModule } from '../summaries/summaries.module';
import { UsersModule } from '../users/users.module';
import { CollectionsController } from './collections.controller';
import { CollectionsRepository } from './collections.repository';
import { CollectionsService } from './collections.service';

@Module({
  imports: [SummariesModule, PermissionsModule, UsersModule],
  controllers: [CollectionsController],
  providers: [CollectionsRepository, CollectionsService],
})
export class CollectionsModule {}
