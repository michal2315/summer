import { Module } from '@nestjs/common';
import { LabelsModule } from '../labels/labels.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { SummaryTemplatesRepository } from './summary-templates.repository';
import { SummaryTemplatesService } from './summary-templates.service';
import { UserStateRepository } from './user-state.repository';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

@Module({
  imports: [LabelsModule, PermissionsModule],
  controllers: [UsersController],
  providers: [UsersRepository, UserStateRepository, UsersService, SummaryTemplatesRepository, SummaryTemplatesService],
  exports: [UsersRepository],
})
export class UsersModule {}
