import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { CapsulesModule } from './capsules/capsules.module';
import { CollectionsModule } from './collections/collections.module';
import { CommentsModule } from './comments/comments.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { ConfigModule } from './config/config.module';
import { ContentTypesModule } from './content-types/content-types.module';
import { DatabaseModule } from './database/database.module';
import { FoldersModule } from './folders/folders.module';
import { HealthController } from './health.controller';
import { LabelsModule } from './labels/labels.module';
import { MilestonesModule } from './milestones/milestones.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PermissionsModule } from './permissions/permissions.module';
import { SummariesModule } from './summaries/summaries.module';
import { UsersModule } from './users/users.module';
import { WhatsNewModule } from './whats-new/whats-new.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuthModule,
    CapsulesModule,
    PermissionsModule,
    UsersModule,
    ContentTypesModule,
    LabelsModule,
    SummariesModule,
    MilestonesModule,
    CommentsModule,
    CollectionsModule,
    FoldersModule,
    NotificationsModule,
    WhatsNewModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
