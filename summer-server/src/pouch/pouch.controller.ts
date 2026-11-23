import { Body, Controller, Delete, Get, Param, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { Me } from '../auth/auth.guard';
import { CurrentUser } from '../auth/identity-provider';
import { ApiPouchFormat } from '../common/api-types';
import { IdPipe } from '../common/validation';
import { PouchService } from './pouch.service';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Pouch: personal export formats, and Word rendering of a filled-in format.
 * GET/POST /pouch-formats · GET /pouch-formats/shared · POST /pouch-formats/docx · GET/PUT/DELETE /pouch-formats/:id ·
 * POST /pouch-formats/:id/copy
 */
@Controller('pouch-formats')
export class PouchController {
  constructor(private readonly pouch: PouchService) {}

  @Get()
  list(@Me() me: CurrentUser): Promise<ApiPouchFormat[]> {
    return this.pouch.list(me);
  }

  @Get('shared')
  shared(@Me() me: CurrentUser, @Query() query: unknown): Promise<ApiPouchFormat[]> {
    return this.pouch.shared(me, query);
  }

  /** The body may be large (images inline as data URLs): its own body limit is set in bootstrap. */
  @Post('docx')
  async docx(@Body() body: unknown): Promise<StreamableFile> {
    return new StreamableFile(await this.pouch.docx(body), { type: DOCX_MIME, disposition: `attachment; filename="summer.docx"` });
  }

  /** Declared after the literal paths so they aren't taken for an id. */
  @Get(':id')
  one(@Me() me: CurrentUser, @Param('id', IdPipe) id: string): Promise<ApiPouchFormat> {
    return this.pouch.get(me, id);
  }

  @Post()
  create(@Me() me: CurrentUser, @Body() body: unknown): Promise<ApiPouchFormat> {
    return this.pouch.create(me, body);
  }

  @Post(':id/copy')
  copy(@Me() me: CurrentUser, @Param('id', IdPipe) id: string, @Body() body: unknown): Promise<ApiPouchFormat> {
    return this.pouch.copy(me, id, body);
  }

  @Put(':id')
  update(@Me() me: CurrentUser, @Param('id', IdPipe) id: string, @Body() body: unknown): Promise<ApiPouchFormat> {
    return this.pouch.update(me, id, body);
  }

  @Delete(':id')
  async remove(@Me() me: CurrentUser, @Param('id', IdPipe) id: string): Promise<object> {
    await this.pouch.remove(me, id);
    return {};
  }
}
