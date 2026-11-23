import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  type ILevelsOptions,
  type IRunOptions,
  LevelFormat,
  Packer,
  PageBreak,
  PageOrientation,
  Paragraph,
  type ParagraphChild,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { PouchPage } from '../database/schema';
import { PmMark, PmNode } from './pouch-doc';

/**
 * Pouch document (Tiptap JSON) → Word file. The document is Hebrew-first: paragraphs are right-to-left unless set left-to-right, alignment
 * and indents are logical (start = right, or left in a left-to-right one), and runs with Hebrew or Arabic letters are marked right-to-left so Word picks
 * the complex-script font settings for them. Field chips still in the document come out as «label».
 */

const FONT = 'Arial';
/** Base size in half-points (11pt), matching the editor's page. */
const BASE_SIZE = 22;
/** 1.3 line spacing (240 = single), 6pt after each paragraph: the editor's paragraph rhythm. */
const SPACING = { line: 312, after: 120 };

/** A4 in twips; docx swaps width and height for landscape. */
const A4 = { width: 11906, height: 16838 };
const MARGINS: Record<PouchPage['margins'], { top: number; bottom: number; side: number }> = {
  narrow: { top: 720, bottom: 720, side: 720 },
  normal: { top: 1440, bottom: 1440, side: 1440 },
  wide: { top: 1440, bottom: 1440, side: 2880 },
};

const HEADING_LEVELS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3] as const;
/** Half-points per heading level; the editor shows the same sizes. */
const HEADING_SIZES = [40, 32, 26];

const BULLETS = ['●', '○', '■'];
const NUMBER_FORMATS = [LevelFormat.DECIMAL, LevelFormat.HEBREW1, LevelFormat.LOWER_ROMAN];
const LIST_INDENT = 567;

const RTL_CHARS = /[֐-ࣿיִ-﷿ﹰ-﻿]/;

type Block = Paragraph | Table;

interface ParaOptions {
  numbering?: { reference: string; level: number; instance?: number };
  indent?: number;
  shading?: string;
  /** Set by a left-to-right list or quote around the paragraph. */
  ltr?: boolean;
}

/** A block's own direction, or the one it sits in. Unset means the page's right-to-left. */
const isLtr = (node: PmNode, opts: ParaOptions) => node.attrs?.dir === 'ltr' || !!opts.ltr;

const listLevels = (kind: 'bullet' | 'number'): ILevelsOptions[] =>
  Array.from({ length: 9 }, (_, level) => ({
    level,
    format: kind === 'bullet' ? LevelFormat.BULLET : NUMBER_FORMATS[level % NUMBER_FORMATS.length],
    text: kind === 'bullet' ? BULLETS[level % BULLETS.length] : `%${level + 1}.`,
    alignment: AlignmentType.START,
    style: { paragraph: { indent: { start: LIST_INDENT * (level + 1), hanging: 360 } } },
  }));

/** CSS colour (#rgb, #rrggbb, rgb()/rgba()) → RRGGBB, or undefined. */
export function hexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) return m[1].split('').map((c) => c + c).join('').toUpperCase();
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(v);
  if (m) return m[1].toUpperCase();
  m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i.exec(v);
  if (m) return [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('').toUpperCase();
  return undefined;
}

/** CSS font size ("12pt", "16px") → half-points, or undefined. */
export function halfPoints(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const m = /^(\d+(?:\.\d+)?)(pt|px)$/i.exec(value.trim());
  if (!m) return undefined;
  const pt = m[2].toLowerCase() === 'px' ? Number(m[1]) * 0.75 : Number(m[1]);
  return pt >= 1 && pt <= 400 ? Math.round(pt * 2) : undefined;
}

/** The first family in a CSS font-family list, unquoted. */
export function fontName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const first = value.split(',')[0]?.trim().replace(/^["']|["']$/g, '');
  return first || undefined;
}

/** Pixel size of a PNG, GIF or JPEG, read from its header. */
export function imageSize(data: Buffer, type: 'png' | 'jpg' | 'gif' | 'bmp'): { width: number; height: number } | null {
  try {
    if (type === 'png') return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
    if (type === 'gif') return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
    if (type === 'bmp') return { width: data.readInt32LE(18), height: Math.abs(data.readInt32LE(22)) };
    let i = 2;
    while (i < data.length) {
      if (data[i] !== 0xff) return null;
      const marker = data[i + 1];
      const len = data.readUInt16BE(i + 2);
      // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: data.readUInt16BE(i + 7), height: data.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  } catch {
    return null;
  }
  return null;
}

const IMAGE_TYPES: Record<string, 'png' | 'jpg' | 'gif' | 'bmp'> = { png: 'png', jpeg: 'jpg', jpg: 'jpg', gif: 'gif', bmp: 'bmp' };

/** A data URL's bytes and Word image type, or null when it isn't one Word can embed. */
function dataImage(src: unknown): { data: Buffer; type: 'png' | 'jpg' | 'gif' | 'bmp' } | null {
  if (typeof src !== 'string') return null;
  const m = /^data:image\/([a-z]+);base64,([a-z0-9+/=\s]+)$/i.exec(src);
  const type = m && IMAGE_TYPES[m[1].toLowerCase()];
  if (!m || !type) return null;
  return { data: Buffer.from(m[2], 'base64'), type };
}

class Renderer {
  /** Each ordered list restarts its numbering: one numbering instance per list. */
  private listInstance = 0;

  constructor(private readonly contentWidthPx: number) {}

  blocks(nodes: PmNode[] | undefined, opts: ParaOptions = {}): Block[] {
    return (nodes ?? []).flatMap((n) => this.block(n, n.attrs?.dir === 'ltr' ? { ...opts, ltr: true } : opts));
  }

  private block(node: PmNode, opts: ParaOptions): Block[] {
    switch (node.type) {
      case 'paragraph':
        return [this.paragraph(node, opts)];
      case 'heading': {
        const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 3);
        return [this.paragraph(node, opts, HEADING_LEVELS[level - 1])];
      }
      case 'bulletList':
      case 'orderedList':
        return this.list(node, opts);
      case 'blockquote':
        return this.blocks(node.content, { ...opts, indent: (opts.indent ?? 0) + LIST_INDENT, shading: 'F2F4F7' });
      case 'horizontalRule':
        return [
          new Paragraph({
            bidirectional: true,
            spacing: SPACING,
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BFBFBF', space: 1 } },
          }),
        ];
      case 'pageBreak':
        return [new Paragraph({ bidirectional: true, children: [new PageBreak()] })];
      case 'timeline':
        // Filled in on the client (a table); one left unfilled shows where it was.
        return [this.paragraph({ type: 'paragraph', content: [{ type: 'text', text: '[ציר זמן]' }] }, opts)];
      case 'image':
        return [new Paragraph({ bidirectional: true, alignment: this.alignment(node.attrs?.textAlign), spacing: SPACING, children: [this.image(node)] })];
      case 'table':
        return [this.table(node)];
      case 'repeatBlock':
      case 'doc':
      case 'listItem':
        return this.blocks(node.content, opts);
      default:
        // Inline content where a block belongs: wrap it in a paragraph rather than lose it.
        return [this.paragraph({ type: 'paragraph', content: [node] }, opts)];
    }
  }

  private paragraph(node: PmNode, opts: ParaOptions, heading?: (typeof HEADING_LEVELS)[number]): Paragraph {
    const ltr = isLtr(node, opts);
    return new Paragraph({
      bidirectional: !ltr,
      heading,
      alignment: this.alignment(node.attrs?.textAlign, ltr),
      spacing: heading ? undefined : SPACING,
      numbering: opts.numbering,
      indent: opts.numbering || !opts.indent ? undefined : { start: opts.indent },
      shading: opts.shading ? { type: ShadingType.CLEAR, fill: opts.shading, color: 'auto' } : undefined,
      children: this.inlines(node.content),
    });
  }

  /** CSS text-align → logical Word alignment. The paragraph's start side (right, or left when left-to-right) is Word's default. */
  private alignment(align: unknown, ltr = false) {
    if (align === 'center') return AlignmentType.CENTER;
    if (align === 'justify') return AlignmentType.BOTH;
    if (align === (ltr ? 'right' : 'left')) return AlignmentType.END;
    return undefined;
  }

  /** List items: the first paragraph carries the number or bullet, later ones line up under it; nested lists go a level deeper. */
  private list(node: PmNode, opts: ParaOptions): Block[] {
    const level = opts.numbering ? opts.numbering.level + 1 : 0;
    const ordered = node.type === 'orderedList';
    const numbering = { reference: ordered ? 'numbers' : 'bullets', level: Math.min(level, 8), instance: ordered ? ++this.listInstance : 0 };
    return (node.content ?? []).flatMap((item) =>
      (item.content ?? []).flatMap((child, i) => {
        if (child.type === 'bulletList' || child.type === 'orderedList') return this.list(child, { ...opts, numbering });
        if (i === 0 && (child.type === 'paragraph' || child.type === 'heading')) return this.block(child, { ...opts, numbering });
        return this.block(child, { ...opts, numbering: undefined, indent: LIST_INDENT * (numbering.level + 1) });
      }),
    );
  }

  private table(node: PmNode): Table {
    const rows = (node.content ?? []).filter((r) => r.type === 'tableRow');
    const columns = Math.max(1, ...rows.map((r) => (r.content ?? []).reduce((n, c) => n + (Number(c.attrs?.colspan) || 1), 0)));
    return new Table({
      visuallyRightToLeft: true,
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: rows.map(
        (row) =>
          new TableRow({
            children: (row.content ?? []).map((cell) => {
              const colspan = Number(cell.attrs?.colspan) || 1;
              const rowspan = Number(cell.attrs?.rowspan) || 1;
              const header = cell.type === 'tableHeader';
              const fill = hexColor(cell.attrs?.backgroundColor) ?? (header ? 'F2F4F7' : undefined);
              const children = this.blocks(cell.content);
              return new TableCell({
                columnSpan: colspan > 1 ? colspan : undefined,
                rowSpan: rowspan > 1 ? rowspan : undefined,
                width: { size: (colspan / columns) * 100, type: WidthType.PERCENTAGE },
                shading: fill ? { type: ShadingType.CLEAR, fill, color: 'auto' } : undefined,
                children: children.length ? children : [new Paragraph({ bidirectional: true })],
              });
            }),
          }),
      ),
    });
  }

  private image(node: PmNode): ParagraphChild {
    const img = dataImage(node.attrs?.src);
    const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : '';
    if (!img) return this.run(alt ? `[${alt}]` : '[תמונה]', {});
    const natural = imageSize(img.data, img.type) ?? { width: 400, height: 300 };
    const wantW = Number(node.attrs?.width) || natural.width;
    const wantH = Number(node.attrs?.height) || (natural.height * wantW) / natural.width;
    const scale = Math.min(1, this.contentWidthPx / wantW);
    return new ImageRun({
      type: img.type,
      data: img.data,
      transformation: { width: Math.round(wantW * scale), height: Math.round(wantH * scale) },
      altText: alt ? { name: alt, description: alt, title: alt } : undefined,
    });
  }

  private inlines(nodes: PmNode[] | undefined): ParagraphChild[] {
    return (nodes ?? []).flatMap((n): ParagraphChild[] => {
      if (n.type === 'text') {
        const run = this.run(n.text ?? '', this.markStyle(n.marks));
        const link = n.marks?.find((m) => m.type === 'link')?.attrs?.href;
        return typeof link === 'string' && /^(https?:|mailto:)/i.test(link) ? [new ExternalHyperlink({ link, children: [run] })] : [run];
      }
      if (n.type === 'hardBreak') return [new TextRun({ break: 1 })];
      if (n.type === 'field') return [this.run(`«${String(n.attrs?.label ?? n.attrs?.key ?? '')}»`, { color: 'C2571B' })];
      if (n.type === 'image') return [this.image(n)];
      // A block inside inline content (shouldn't happen): keep its text.
      return this.inlines(n.content);
    });
  }

  private markStyle(marks: PmMark[] | undefined): IRunOptions {
    const style: { -readonly [K in keyof IRunOptions]: IRunOptions[K] } = {};
    for (const m of marks ?? []) {
      switch (m.type) {
        case 'bold':
          style.bold = true;
          break;
        case 'italic':
          style.italics = true;
          break;
        case 'underline':
          style.underline = {};
          break;
        case 'strike':
          style.strike = true;
          break;
        case 'subscript':
          style.subScript = true;
          break;
        case 'superscript':
          style.superScript = true;
          break;
        case 'code':
          style.font = 'Consolas';
          break;
        case 'link':
          style.color = '0563C1';
          style.underline = {};
          break;
        case 'textStyle': {
          const color = hexColor(m.attrs?.color);
          const fill = hexColor(m.attrs?.backgroundColor);
          const size = halfPoints(m.attrs?.fontSize);
          const font = fontName(m.attrs?.fontFamily);
          if (color) style.color = color;
          if (fill) style.shading = { type: ShadingType.CLEAR, fill, color: 'auto' };
          if (size) style.size = size;
          if (font) style.font = font;
          break;
        }
      }
    }
    return style;
  }

  private run(text: string, style: IRunOptions): TextRun {
    return new TextRun({ ...style, text, rightToLeft: RTL_CHARS.test(text) || undefined });
  }
}

/** Render a Pouch document to a .docx buffer. */
export async function renderDocx(doc: PmNode, page: PouchPage, title = ''): Promise<Buffer> {
  const margin = MARGINS[page.margins] ?? MARGINS.normal;
  const landscape = page.orientation === 'landscape';
  const contentTwips = (landscape ? A4.height : A4.width) - 2 * margin.side;
  const renderer = new Renderer(Math.floor(contentTwips / 15));
  const children = renderer.blocks(doc.content);

  const document = new Document({
    creator: 'Summer',
    title: title || undefined,
    styles: {
      default: { document: { run: { font: FONT, size: BASE_SIZE } } },
      paragraphStyles: HEADING_SIZES.map((size, i) => ({
        id: `Heading${i + 1}`,
        name: `Heading ${i + 1}`,
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { font: FONT, size, bold: true, color: '05043D' },
        paragraph: { spacing: { before: 240, after: 120 }, keepNext: true },
      })),
    },
    numbering: {
      config: [
        { reference: 'bullets', levels: listLevels('bullet') },
        { reference: 'numbers', levels: listLevels('number') },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { ...A4, orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
            margin: { top: margin.top, bottom: margin.bottom, left: margin.side, right: margin.side },
          },
        },
        children: children.length ? children : [new Paragraph({ bidirectional: true })],
      },
    ],
  });
  return Packer.toBuffer(document);
}
