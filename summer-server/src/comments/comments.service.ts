import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CurrentUser } from '../auth/identity-provider';
import { ApiComment, toRef } from '../common/api-types';
import { isUuid, unique } from '../common/validation';
import { DatabaseService } from '../database/database.service';
import { Mention } from '../database/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { SummariesService } from '../summaries/summaries.service';
import { CommentsRepository } from './comments.repository';

/** Comments inherit their summary's access: anyone who can view it may comment; only the author may delete. */
@Injectable()
export class CommentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly comments: CommentsRepository,
    private readonly summaries: SummariesService,
    private readonly notifications: NotificationsService,
  ) {}

  async add(me: CurrentUser, input: { summaryId: string; content: string; mentions: Mention[] }): Promise<ApiComment> {
    await this.summaries.assertVisible(me, input.summaryId);
    const row = await this.database.transaction(async () => {
      const comment = await this.comments.insert({ ...input, createdBy: me.id });
      const summary = (await this.comments.summaryMeta(input.summaryId))!;
      await this.notifications.notify([summary.createdBy], {
        summaryId: input.summaryId,
        text: `${me.fullName} הגיב/ה על הסיכום "${summary.title}"`,
        createdBy: me.id,
      });
      const mentioned = unique(input.mentions.filter((m) => m.type === 'user' && isUuid(m._id)).map((m) => m._id)).filter((id) => id !== summary.createdBy);
      await this.notifications.notify(mentioned, { summaryId: input.summaryId, text: `${me.fullName} הזכיר/ה אותך בתגובה`, createdBy: me.id });
      return comment;
    });
    return { _id: row.id, content: row.content, mentions: row.mentions, user: toRef(me), creationDate: row.createdAt.toISOString() };
  }

  async remove(me: CurrentUser, id: string, summaryId: string): Promise<void> {
    await this.summaries.assertVisible(me, summaryId);
    const comment = await this.comments.find(id, summaryId);
    if (!comment) throw new NotFoundException();
    if (comment.createdBy !== me.id) throw new ForbiddenException();
    await this.comments.delete(id);
  }
}
