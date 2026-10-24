import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SummariesModule } from '../summaries/summaries.module';
import { CommentsController } from './comments.controller';
import { CommentsRepository } from './comments.repository';
import { CommentsService } from './comments.service';

@Module({
  imports: [SummariesModule, NotificationsModule],
  controllers: [CommentsController],
  providers: [CommentsRepository, CommentsService],
})
export class CommentsModule {}
