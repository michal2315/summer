import { Controller, Get } from '@nestjs/common';
import { ApiContentType, ApiField } from '../common/api-types';
import { ContentTypesRepository, toApiContentType, toApiField } from './content-types.repository';

// `GET /field/summaries` (summaries by field value) lives in SummariesModule.
@Controller()
export class ContentTypesController {
  constructor(private readonly contentTypes: ContentTypesRepository) {}

  @Get('content-type')
  async list(): Promise<ApiContentType[]> {
    return (await this.contentTypes.contentTypes()).map(toApiContentType);
  }

  @Get('field')
  async fields(): Promise<ApiField[]> {
    return (await this.contentTypes.fields()).map(toApiField);
  }
}
