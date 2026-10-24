import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { parse } from '../common/validation';
import { LabelsRepository } from './labels.repository';

const labelsQuery = z.object({
  text: z.string().max(100).default(''),
  skip: z.coerce.number().int().min(0).max(10_000).default(0),
});

@Controller('labels')
export class LabelsController {
  constructor(private readonly labels: LabelsRepository) {}

  /** Autocomplete: label names containing `text`, 20 per page. */
  @Get()
  list(@Query() query: unknown): Promise<string[]> {
    const { text, skip } = parse(labelsQuery, query);
    return this.labels.names(text.trim(), skip);
  }
}
