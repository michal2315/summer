import { Body, Controller, Delete, Param, Put } from '@nestjs/common';
import { z } from 'zod';
import { Me } from '../auth/auth.guard';
import { CurrentUser } from '../auth/identity-provider';
import { ApiComment } from '../common/api-types';
import { IdPipe, parse, zId } from '../common/validation';
import { CommentsService } from './comments.service';

const addBody = z.object({
  summaryId: zId,
  content: z.string().trim().min(1).max(5000),
  mentions: z
    .array(
      z.object({
        _id: z.string().max(100),
        type: z.enum(['user', 'label']),
        value: z.string().max(200),
        icon: z.string().max(200).optional(),
      }),
    )
    .max(50)
    .default([]),
});
const deleteBody = z.object({ summaryId: zId });

@Controller('comment')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Put()
  add(@Me() me: CurrentUser, @Body() body: unknown): Promise<ApiComment> {
    return this.comments.add(me, parse(addBody, body));
  }

  @Delete(':id')
  async remove(@Me() me: CurrentUser, @Param('id', IdPipe) id: string, @Body() body: unknown): Promise<object> {
    await this.comments.remove(me, id, parse(deleteBody, body).summaryId);
    return {};
  }
}
