import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { CurrentUser } from '../auth/identity-provider';
import { ApiSummary } from '../common/api-types';
import { escapeHtml, htmlToText } from '../common/html';
import { zonedDate } from '../common/time';
import { parse, unique, zId } from '../common/validation';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { SummariesRepository } from './summaries.repository';
import { SummariesService } from './summaries.service';
import { summarySearchSchema } from './summary-search';

const templateBody = z.object({ fieldNames: z.array(z.string().max(200)).max(200).default([]) });

const exportBody = z.object({
  summariesId: z.array(zId).max(10_000).default([]),
  all: z.boolean().default(false),
  search: summarySearchSchema.optional(),
});

/** headersMap: Excel column header → target key (title/content/labels/eventDate/notes/department or a field id). */
const importFields = z.object({
  type: zId,
  collections: z.array(zId).default([]),
  permissions: z.array(zId).default([]),
  headersMap: z.record(z.string(), z.string()),
});

const EXPORT_CHUNK = 200;
const BASE_KEYS = new Set(['title', 'content', 'labels', 'eventDate', 'notes', 'department']);

@Injectable()
export class ExcelService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly summaries: SummariesService,
    private readonly repo: SummariesRepository,
  ) {}

  template(body: unknown): Buffer {
    const { fieldNames } = parse(templateBody, body);
    return this.workbook([fieldNames]);
  }

  async export(me: CurrentUser, body: unknown): Promise<Buffer> {
    const req = parse(exportBody, body);
    const cap = this.config.excel.exportMax;
    let ids: string[];
    if (req.all) {
      ids = await this.summaries.searchAllIds(me, req.search ?? parse(summarySearchSchema, {}), cap);
    } else {
      const wanted = unique(req.summariesId).slice(0, cap);
      const visible = await this.repo.visibleIds(me, wanted);
      ids = wanted.filter((id) => visible.has(id));
    }

    const rows: unknown[][] = [['כותרת', 'מחבר', 'סוג', 'תאריך האירוע', 'תגיות', 'תוכן']];
    for (let i = 0; i < ids.length; i += EXPORT_CHUNK) {
      for (const s of await this.summaries.hydrate(me, ids.slice(i, i + EXPORT_CHUNK))) rows.push(this.exportRow(s));
    }
    return this.workbook(rows);
  }

  async import(me: CurrentUser, file: { buffer: Buffer } | undefined, fields: Record<string, unknown>): Promise<{ created: number }> {
    if (!file) throw new BadRequestException('file is required');
    let headersMap: unknown;
    try {
      headersMap = JSON.parse(String(fields.headersMap ?? '{}'));
    } catch {
      throw new BadRequestException('headersMap must be JSON');
    }
    const req = parse(importFields, { ...fields, collections: asList(fields.collections), permissions: asList(fields.permissions), headersMap });

    let sheetRows: Record<string, unknown>[];
    try {
      const book = XLSX.read(file.buffer, { type: 'buffer', cellDates: true });
      const sheet = book.Sheets[book.SheetNames[0]];
      sheetRows = sheet ? XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false, dateNF: 'yyyy-mm-dd' }) : [];
    } catch {
      throw new BadRequestException('could not read the spreadsheet');
    }
    if (sheetRows.length > this.config.excel.importMaxRows) throw new BadRequestException(`at most ${this.config.excel.importMaxRows} rows per import`);

    const payloads = sheetRows.flatMap((row) => {
      const v: Record<string, string> = {};
      for (const [header, key] of Object.entries(req.headersMap)) v[key] = String(row[header] ?? '').trim();
      if (!v.title) return [];
      return [
        {
          title: v.title,
          contentHtml: v.content ? `<p>${escapeHtml(v.content)}</p>` : '',
          notesHtml: v.notes ? `<p>${escapeHtml(v.notes)}</p>` : '',
          contentType: req.type,
          eventDate: this.toDay(v.eventDate),
          department: v.department || me.department,
          labels: (v.labels ?? '').split(/[,،]/).map((l) => l.trim()).filter(Boolean),
          collectionIds: req.collections,
          permissions: req.permissions,
          taggedUsers: [],
          summaryFields: Object.entries(v)
            .filter(([k, value]) => value && !BASE_KEYS.has(k))
            .map(([field, value]) => ({ field, value })),
          files: [],
          isDraft: false,
        },
      ];
    });
    return { created: await this.summaries.importMany(me, payloads) };
  }

  private exportRow(s: ApiSummary): unknown[] {
    const date = s.eventDate ? zonedDate(new Date(s.eventDate), this.config.timezone) : null;
    return [
      s.title,
      s.user.fullName,
      s.contentType.displayName,
      date ? `${String(date[2]).padStart(2, '0')}/${String(date[1]).padStart(2, '0')}/${date[0]}` : '',
      s.labels.map((l) => l.name).join(', '),
      htmlToText(s.content),
    ];
  }

  /** Spreadsheet date cell (formatted yyyy-mm-dd, or free text) → yyyy-MM-dd, or undefined. */
  private toDay(value: string | undefined): string | undefined {
    if (!value) return undefined;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return undefined;
    const [y, m, day] = zonedDate(d, this.config.timezone);
    return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  private workbook(rows: unknown[][]): Buffer {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!views'] = [{ RTL: true }];
    XLSX.utils.book_append_sheet(book, sheet, 'Summer');
    return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }
}

const asList = (v: unknown): string[] => (v === undefined ? [] : Array.isArray(v) ? v.map(String) : [String(v)]);
