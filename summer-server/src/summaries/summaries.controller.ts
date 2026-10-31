import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { Me } from '../auth/auth.guard';
import { CurrentUser } from '../auth/identity-provider';
import { ApiBulkResult, ApiSummary, SummaryLengths } from '../common/api-types';
import { IdPipe, parse, zId } from '../common/validation';
import { ExcelService } from './excel.service';
import { UploadedFile as Upload } from './files.service';
import { SummariesService } from './summaries.service';
import { WordService } from './word.service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const idBody = z.object({ id: zId.optional(), summaryId: zId.optional() }).passthrough();
const downloadQuery = z.object({ summaryId: zId, fileName: z.string().min(1).max(255) });

/** Client sends `{ id, summaryId, … }` on these endpoints; either names the summary. */
function bodyId(body: unknown): string {
  const b = parse(idBody, body ?? {});
  const id = b.id ?? b.summaryId;
  if (!id) throw new BadRequestException('id is required');
  return id;
}

/** Multipart `summary` field holds the SummaryPayload as JSON. */
function payloadOf(body: { summary?: unknown }): unknown {
  if (typeof body?.summary !== 'string') throw new BadRequestException('multipart field "summary" is required');
  try {
    return JSON.parse(body.summary);
  } catch {
    throw new BadRequestException('"summary" must be JSON');
  }
}

const contentDisposition = (name: string) => `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;

// Route order matters: literal segments are declared before the `:id/:isMine` catch-all.
@Controller('summary')
export class SummariesController {
  constructor(
    private readonly summaries: SummariesService,
    private readonly excel: ExcelService,
    private readonly word: WordService,
  ) {}

  @Get('download')
  async download(@Me() me: CurrentUser, @Query() query: unknown): Promise<StreamableFile> {
    const { summaryId, fileName } = parse(downloadQuery, query);
    const { meta, stream } = await this.summaries.attachment(me, summaryId, fileName);
    return new StreamableFile(stream, { type: meta.mimeType, length: meta.size, disposition: contentDisposition(meta.fileName) });
  }

  @Get('user/:userId/dashboard')
  dashboard(@Me() me: CurrentUser): Promise<Record<string, ApiSummary[]>> {
    return this.summaries.dashboard(me);
  }

  /** Feed (own id, isProfile=false) and profile tabs (isProfile=true, any user's id). */
  @Get('user/:userId')
  search(@Me() me: CurrentUser, @Param('userId', IdPipe) userId: string, @Query() query: unknown): Promise<{ summaries: ApiSummary[]; lengths: SummaryLengths }> {
    return this.summaries.search(me, userId, this.summaries.parseSearch(query));
  }

  /** How many published summaries a search would find (the advanced search's live result count). */
  @Get('count')
  async count(@Me() me: CurrentUser, @Query() query: unknown): Promise<{ count: number }> {
    return { count: await this.summaries.count(me, this.summaries.parseSearch(query)) };
  }

  /** `isMine` is a legacy path segment; access is decided server-side. */
  @Get(':id/:isMine')
  get(@Me() me: CurrentUser, @Param('id', IdPipe) id: string): Promise<ApiSummary> {
    return this.summaries.get(me, id);
  }

  @Post()
  @UseInterceptors(FilesInterceptor('files'))
  create(@Me() me: CurrentUser, @Body() body: { summary?: unknown }, @UploadedFiles() files: Upload[] = []): Promise<ApiSummary> {
    return this.summaries.create(me, payloadOf(body), files);
  }

  @Put()
  @UseInterceptors(FilesInterceptor('files'))
  update(@Me() me: CurrentUser, @Body() body: { summary?: unknown }, @UploadedFiles() files: Upload[] = []): Promise<ApiSummary> {
    return this.summaries.update(me, payloadOf(body), files);
  }

  @Delete()
  async remove(@Me() me: CurrentUser, @Body() body: unknown): Promise<object> {
    await this.summaries.delete(me, bodyId(body));
    return {};
  }

  @Put('color')
  async color(@Me() me: CurrentUser, @Body() body: { color?: unknown }): Promise<object> {
    await this.summaries.setColor(me, bodyId(body), body?.color ?? '');
    return {};
  }

  @Put('to-draft')
  async toDraft(@Me() me: CurrentUser, @Body() body: unknown): Promise<object> {
    await this.summaries.toDraft(me, bodyId(body));
    return {};
  }

  /** `{ summaryIds, add, remove }` → which summaries changed and which were skipped (and why). */
  @Post('bulk/labels')
  bulkLabels(@Me() me: CurrentUser, @Body() body: unknown): Promise<ApiBulkResult> {
    return this.summaries.bulkLabels(me, body);
  }

  /** `{ summaryIds, color }` ('' clears it). */
  @Post('bulk/color')
  bulkColor(@Me() me: CurrentUser, @Body() body: unknown): Promise<ApiBulkResult> {
    return this.summaries.bulkColor(me, body);
  }

  @Post('bulk/to-draft')
  bulkToDraft(@Me() me: CurrentUser, @Body() body: unknown): Promise<ApiBulkResult> {
    return this.summaries.bulkToDraft(me, body);
  }

  @Post('bulk/delete')
  bulkDelete(@Me() me: CurrentUser, @Body() body: unknown): Promise<ApiBulkResult> {
    return this.summaries.bulkDelete(me, body);
  }

  @Put('updateTimelineTitle')
  async timelineTitle(@Me() me: CurrentUser, @Body() body: { timelineTitle?: unknown }): Promise<object> {
    await this.summaries.setTimelineTitle(me, bodyId(body), body?.timelineTitle ?? '');
    return {};
  }

  @Post('download/template')
  template(@Body() body: unknown): StreamableFile {
    return new StreamableFile(this.excel.template(body), { type: XLSX_MIME, disposition: contentDisposition('template.xlsx') });
  }

  @Post('download/excel')
  async exportExcel(@Me() me: CurrentUser, @Body() body: unknown): Promise<StreamableFile> {
    return new StreamableFile(await this.excel.export(me, body), { type: XLSX_MIME, disposition: contentDisposition('summer.xlsx') });
  }

  /** Same selection as the Excel export, as a Word table between the user's own title/intro/outro text. */
  @Post('download/word')
  async exportWord(@Me() me: CurrentUser, @Body() body: unknown): Promise<StreamableFile> {
    return new StreamableFile(await this.word.export(me, body), { type: DOCX_MIME, disposition: contentDisposition('summer.docx') });
  }

  @Post('upload/excel')
  @UseInterceptors(FileInterceptor('file'))
  importExcel(@Me() me: CurrentUser, @UploadedFile() file: Upload | undefined, @Body() body: Record<string, unknown>): Promise<{ created: number }> {
    return this.excel.import(me, file, body);
  }
}
