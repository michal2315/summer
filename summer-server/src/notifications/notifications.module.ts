import { Module } from '@nestjs/common';
import { ContentTypesModule } from '../content-types/content-types.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [ContentTypesModule, PermissionsModule],
  controllers: [NotificationsController],
  providers: [NotificationsRepository, NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
