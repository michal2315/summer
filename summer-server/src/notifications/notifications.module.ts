import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ContentTypesModule } from '../content-types/content-types.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { MailWorker } from './mail-worker';
import { Mailer, createMailer } from './mailer';
import { NotificationsController } from './notifications.controller';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [ContentTypesModule, PermissionsModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsRepository,
    NotificationsService,
    { provide: Mailer, useFactory: (config: AppConfig) => createMailer(config), inject: [APP_CONFIG] },
    MailWorker,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
