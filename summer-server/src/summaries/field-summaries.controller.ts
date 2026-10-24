import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { Me } from '../auth/auth.guard';
import { CurrentUser } from '../auth/identity-provider';
import { parse, zId } from '../common/validation';
import { SummariesRepository } from './summaries.repository';

const query = z.object({ fieldId: zId, value: z.string().max(500) });

/** `GET /field/summaries`: summaries (visible to the caller) whose custom field `fieldId` equals `value`. */
@Controller('field')
export class FieldSummariesController {
  constructor(private readonly summaries: SummariesRepository) {}

  @Get('summaries')
  async byField(@Me() me: CurrentUser, @Query() raw: unknown): Promise<{ _id: string; title: string }[]> {
    const { fieldId, value } = parse(query, raw);
    return (await this.summaries.byField(me, fieldId, value)).map((r) => ({ _id: r.id, title: r.title }));
  }
}
