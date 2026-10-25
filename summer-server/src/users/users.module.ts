import { Module } from '@nestjs/common';
import { LabelsModule } from '../labels/labels.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { UserStateRepository } from './user-state.repository';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

@Module({
  imports: [LabelsModule, PermissionsModule],
  controllers: [UsersController],
  providers: [UsersRepository, UserStateRepository, UsersService],
  exports: [UsersRepository],
})
export class UsersModule {}
