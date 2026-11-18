import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';
import { UserGroupsController } from './user-groups.controller';
import { UserGroupsRepository } from './user-groups.repository';
import { UserGroupsService } from './user-groups.service';

@Module({
  imports: [UsersModule, PermissionsModule],
  controllers: [UserGroupsController],
  providers: [UserGroupsRepository, UserGroupsService],
})
export class UserGroupsModule {}
