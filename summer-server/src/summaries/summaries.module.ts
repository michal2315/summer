import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ContentTypesModule } from '../content-types/content-types.module';
import { LabelsModule } from '../labels/labels.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';
import { ExcelService } from './excel.service';
import { FieldSummariesController } from './field-summaries.controller';
import { NotificationFeedController } from './notification-feed.controller';
import { FilesService } from './files.service';
import { SummariesController } from './summaries.controller';
import { SummariesRepository } from './summaries.repository';
import { SummariesService } from './summaries.service';
import { WordService } from './word.service';

/** Quill content (with inline images) arrives as a multipart text field, so allow it to be large. */
const MAX_PAYLOAD_FIELD_BYTES = 25 * 1024 * 1024;

@Module({
  imports: [
    ContentTypesModule,
    LabelsModule,
    NotificationsModule,
    PermissionsModule,
    UsersModule,
    MulterModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        storage: memoryStorage(),
        limits: { fileSize: config.files.maxFileBytes, files: config.files.maxFiles, fieldSize: MAX_PAYLOAD_FIELD_BYTES },
      }),
    }),
  ],
  controllers: [SummariesController, FieldSummariesController, NotificationFeedController],
  providers: [SummariesRepository, SummariesService, FilesService, ExcelService, WordService],
  exports: [SummariesService, SummariesRepository],
})
export class SummariesModule {}
