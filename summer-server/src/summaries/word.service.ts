import { Injectable } from '@nestjs/common';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { z } from 'zod';
import { CurrentUser } from '../auth/identity-provider';
import { parse } from '../common/validation';
import { ExcelService, exportBody } from './excel.service';

/** Same selection as the Excel export, plus the user's own text around the table (plain text, newline = paragraph). */
const wordBody = exportBody.extend({
  title: z.string().max(500).default(''),
  intro: z.string().max(50_000).default(''),
  outro: z.string().max(50_000).default(''),
});

const FONT = 'Arial';
/** Relative column widths (percent), in the order of the export header. */
const COLUMN_WIDTHS = [18, 10, 9, 9, 12, 42];

@Injectable()
export class WordService {
  constructor(private readonly excel: ExcelService) {}

  async export(me: CurrentUser, body: unknown): Promise<Buffer> {
    const req = parse(wordBody, body);
    const [header, ...rows] = await this.excel.rows(me, req);

    const doc = new Document({
      styles: { default: { document: { run: { font: FONT, size: 22, rightToLeft: true } } } },
      sections: [
        {
          properties: { page: { size: { orientation: PageOrientation.LANDSCAPE } } },
          children: [
            ...(req.title.trim()
              ? [new Paragraph({ heading: HeadingLevel.TITLE, bidirectional: true, alignment: AlignmentType.CENTER, children: [this.run(req.title.trim())] })]
              : []),
            ...this.paragraphs(req.intro),
            new Table({
              visuallyRightToLeft: true,
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [this.row(header, true), ...rows.map((r) => this.row(r, false))],
            }),
            ...this.paragraphs(req.outro),
          ],
        },
      ],
    });
    return Packer.toBuffer(doc);
  }

  private row(cells: string[], isHeader: boolean): TableRow {
    return new TableRow({
      tableHeader: isHeader,
      cantSplit: isHeader,
      children: cells.map(
        (text, i) =>
          new TableCell({
            width: { size: COLUMN_WIDTHS[i], type: WidthType.PERCENTAGE },
            shading: isHeader ? { type: ShadingType.CLEAR, fill: 'D9E2F3', color: 'auto' } : undefined,
            children: this.lines(text, isHeader),
          }),
      ),
    });
  }

  /** User text: a paragraph per line (blank lines kept), spaced away from the table. */
  private paragraphs(text: string): Paragraph[] {
    if (!text.trim()) return [];
    return text
      .trim()
      .split(/\r?\n/)
      .map((l) => new Paragraph({ bidirectional: true, spacing: { before: 120, after: 120 }, children: l.trim() ? [this.run(l.trim())] : [] }));
  }

  /** Cell text: a paragraph per line (a cell needs at least one paragraph). */
  private lines(text: string, bold: boolean): Paragraph[] {
    return text.split(/\r?\n/).map((l) => new Paragraph({ bidirectional: true, children: [this.run(l, bold)] }));
  }

  private run(text: string, bold = false): TextRun {
    return new TextRun({ text, bold, rightToLeft: true, font: FONT });
  }
}
