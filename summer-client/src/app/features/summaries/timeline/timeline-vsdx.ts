import { strToU8, zipSync } from 'fflate';

export const VSDX_MIME = 'application/vnd.ms-visio.drawing';

export interface VsdxTimelineItem {
  /** Already formatted (dd/MM/yyyy). */
  date: string;
  title: string;
  /** Card border and dot color (#rgb / #rrggbb); otherwise the accent. */
  color?: string;
  /** Custom events: dashed card, gray dot. */
  custom: boolean;
  /** Opened from the card in Visio (Ctrl+click). */
  link?: string;
}

export interface VsdxTimeline {
  title: string;
  /** Ordered by date, earliest first. */
  items: VsdxTimelineItem[];
  /** The theme's accent (dots and line), #rrggbb. */
  accent: string;
}

// Layout mirrors the modal's track (timeline-modal.component.scss), in inches (96px = 1in). RTL: earliest on the right.
const px = (n: number) => n / 96;
const PAD = px(20);
const SLOT = px(150);
const CARD_W = px(136);
const CARD_H = px(92);
const HEIGHT = px(260);
const DOT = px(15);
const LINE_H = px(3);
const TEXT = px(12);
const TITLE_TEXT = px(13);

const GRAY = '#9B9BB1';
const DARK_GRAY = '#666666';
const CARD_FILL = '#F7F7F7';
const CARD_LINE = '#E8E8E8';
const WHITE = '#FFFFFF';
const PT = 1 / 72;

const NS = 'http://schemas.microsoft.com/office/visio/2012/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.microsoft.com/visio/2010/relationships';

function esc(t: string): string {
  return (
    t
      // XML 1.0 forbids most control characters.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  );
}

/** #rgb / #rrggbb → #RRGGBB; anything else → null. */
export function hexColor(c: string | undefined | null): string | null {
  const m = c?.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1];
  return `#${h.toUpperCase()}`;
}

const n = (v: number) => String(Math.round(v * 1e6) / 1e6);
const cell = (name: string, v: number | string, f?: string) =>
  `<Cell N="${name}" V="${typeof v === 'number' ? n(v) : esc(v)}"${f ? ` F="${esc(f)}"` : ''}/>`;

/** Position and size; the pin is the center, so the shape resizes around it. */
function xform(cx: number, cy: number, w: number, h: number): string {
  return (
    cell('PinX', cx) +
    cell('PinY', cy) +
    cell('Width', w) +
    cell('Height', h) +
    cell('LocPinX', w / 2, 'Width*0.5') +
    cell('LocPinY', h / 2, 'Height*0.5') +
    cell('Angle', 0)
  );
}

/** Geometry written against Width/Height so it follows when the shape is resized in Visio. */
function rectGeometry(w: number, h: number, noLine = false): string {
  const pt = (t: string, ix: number, x: 0 | 1, y: 0 | 1) =>
    `<Row T="${t}" IX="${ix}">${cell('X', x * w, `Width*${x}`)}${cell('Y', y * h, `Height*${y}`)}</Row>`;
  return (
    `<Section N="Geometry" IX="0">${cell('NoFill', 0)}${cell('NoLine', noLine ? 1 : 0)}${cell('NoShow', 0)}${cell('NoSnap', 0)}` +
    pt('MoveTo', 1, 0, 0) +
    pt('LineTo', 2, 1, 0) +
    pt('LineTo', 3, 1, 1) +
    pt('LineTo', 4, 0, 1) +
    pt('LineTo', 5, 0, 0) +
    `</Section>`
  );
}

function ellipseGeometry(w: number, h: number): string {
  return (
    `<Section N="Geometry" IX="0">${cell('NoFill', 0)}${cell('NoLine', 0)}${cell('NoShow', 0)}${cell('NoSnap', 0)}` +
    `<Row T="Ellipse" IX="1">` +
    cell('X', w / 2, 'Width*0.5') +
    cell('Y', h / 2, 'Height*0.5') +
    cell('A', w, 'Width*1') +
    cell('B', h / 2, 'Height*0.5') +
    cell('C', w / 2, 'Width*0.5') +
    cell('D', h, 'Height*1') +
    `</Row></Section>`
  );
}

/** One character-format row; Hebrew needs right-to-left text. */
function charRow(ix: number, color: string, size: number, bold: boolean): string {
  return `<Row IX="${ix}">${cell('Color', color)}${cell('Style', bold ? 1 : 0)}${cell('Size', size)}${cell('RTLText', 1)}</Row>`;
}

/** Right-aligned, right-to-left paragraphs. */
const RTL_PARA = `<Section N="Paragraph"><Row IX="0">${cell('HorzAlign', 2)}${cell('Flags', 1)}</Row></Section>`;

class Shapes {
  private id = 0;
  readonly xml: string[] = [];

  add(name: string, body: string, text = ''): void {
    this.id++;
    this.xml.push(
      `<Shape ID="${this.id}" NameU="${esc(name)}" Name="${esc(name)}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">${body}${text ? `<Text>${text}</Text>` : ''}</Shape>`,
    );
  }
}

function pageXml(t: VsdxTimeline, width: number): string {
  const shapes = new Shapes();
  const lineY = HEIGHT / 2;

  shapes.add(
    'Title',
    xform(width - PAD - px(150), HEIGHT - px(6) - px(10), px(300), px(20)) +
      cell('LinePattern', 0) +
      cell('FillPattern', 0) +
      cell('VerticalAlign', 1) +
      cell('LeftMargin', 0) +
      cell('RightMargin', 0) +
      `<Section N="Character">${charRow(0, DARK_GRAY, TITLE_TEXT, true)}</Section>` +
      RTL_PARA +
      rectGeometry(px(300), px(20), true),
    `<cp IX="0"/>${esc(t.title)}`,
  );

  shapes.add(
    'Line',
    xform(width / 2, lineY, width, LINE_H) + cell('LinePattern', 0) + cell('FillForegnd', t.accent) + cell('FillPattern', 1) + rectGeometry(width, LINE_H, true),
  );

  t.items.forEach((item, i) => {
    const cx = width - PAD - (i + 0.5) * SLOT;
    const up = i % 2 === 1;
    const cy = up ? HEIGHT - px(30) - CARD_H / 2 : px(4) + CARD_H / 2;
    const color = item.custom ? GRAY : (hexColor(item.color) ?? t.accent);
    const ownColor = !item.custom && !!hexColor(item.color);

    shapes.add(
      item.custom ? 'Event' : 'Summary',
      xform(cx, cy, CARD_W, CARD_H) +
        cell('FillForegnd', item.custom ? WHITE : CARD_FILL) +
        cell('FillPattern', 1) +
        cell('LineColor', item.custom ? GRAY : ownColor ? color : CARD_LINE) +
        cell('LineWeight', (ownColor ? 1.5 : 0.75) * PT) +
        cell('LinePattern', item.custom ? 2 : 1) +
        cell('Rounding', px(8)) +
        cell('VerticalAlign', 0) +
        cell('TopMargin', px(6)) +
        cell('BottomMargin', px(6)) +
        cell('LeftMargin', px(8)) +
        cell('RightMargin', px(8)) +
        `<Section N="Character">${charRow(0, GRAY, TEXT, true)}${charRow(1, '#000000', TEXT, true)}</Section>` +
        RTL_PARA +
        (item.link
          ? `<Section N="Hyperlink"><Row N="Row_1">${cell('Address', item.link)}${cell('Default', 1)}</Row></Section>`
          : '') +
        rectGeometry(CARD_W, CARD_H),
      `<cp IX="0"/>${esc(item.date)}\n<cp IX="1"/>${esc(item.title)}`,
    );

    shapes.add(
      'Dot',
      xform(cx, lineY, DOT, DOT) +
        cell('FillForegnd', color) +
        cell('FillPattern', 1) +
        cell('LineColor', WHITE) +
        cell('LineWeight', 2.25 * PT) +
        cell('LinePattern', 1) +
        ellipseGeometry(DOT, DOT),
    );
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<PageContents xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve"><Shapes>${shapes.xml.join('')}</Shapes></PageContents>`;
}

/** Defaults every shape inherits (style 0). */
const NO_STYLE =
  `<StyleSheet ID="0" NameU="No Style" Name="No Style">` +
  cell('EnableLineProps', 1) +
  cell('EnableFillProps', 1) +
  cell('EnableTextProps', 1) +
  cell('HideForApply', 0) +
  cell('LineWeight', 0.75 * PT) +
  cell('LineColor', '#000000') +
  cell('LinePattern', 1) +
  cell('Rounding', 0) +
  cell('LineCap', 0) +
  cell('BeginArrow', 0) +
  cell('EndArrow', 0) +
  cell('FillForegnd', WHITE) +
  cell('FillBkgnd', WHITE) +
  cell('FillPattern', 1) +
  cell('ShdwPattern', 0) +
  cell('LeftMargin', 0) +
  cell('RightMargin', 0) +
  cell('TopMargin', 0) +
  cell('BottomMargin', 0) +
  cell('VerticalAlign', 1) +
  cell('TextBkgnd', 0) +
  `<Section N="Character">${charRow(0, '#000000', TEXT, false)}</Section>` +
  RTL_PARA +
  `</StyleSheet>`;

/** A one-page Visio drawing (.vsdx) of the timeline, every card, dot and the line as its own editable shape. */
export function buildTimelineVsdx(t: VsdxTimeline): Uint8Array {
  const width = Math.max(PAD * 2 + t.items.length * SLOT, px(400));
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  const files: Record<string, string> = {
    '[Content_Types].xml':
      xml +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>` +
      `<Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>` +
      `<Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/>` +
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
      `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
      `</Types>`,
    '_rels/.rels':
      xml +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>` +
      `<Relationship Id="rId3" Type="${REL}/document" Target="visio/document.xml"/>` +
      `</Relationships>`,
    'docProps/core.xml':
      xml +
      `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dc:title>${esc(t.title)}</dc:title>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created>` +
      `</cp:coreProperties>`,
    'docProps/app.xml':
      xml +
      `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Summer</Application></Properties>`,
    'visio/document.xml':
      xml +
      `<VisioDocument xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve">` +
      `<DocumentSettings TopPage="0" DefaultTextStyle="0" DefaultLineStyle="0" DefaultFillStyle="0" DefaultGuideStyle="0"/>` +
      `<Colors><ColorEntry IX="0" RGB="#000000"/><ColorEntry IX="1" RGB="#FFFFFF"/></Colors>` +
      `<StyleSheets>${NO_STYLE}</StyleSheets>` +
      `</VisioDocument>`,
    'visio/_rels/document.xml.rels':
      xml +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${REL}/pages" Target="pages/pages.xml"/>` +
      `</Relationships>`,
    'visio/pages/pages.xml':
      xml +
      `<Pages xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve">` +
      `<Page ID="0" NameU="Page-1" Name="${esc(t.title.slice(0, 31))}">` +
      `<PageSheet LineStyle="0" FillStyle="0" TextStyle="0">` +
      cell('PageWidth', width) +
      cell('PageHeight', HEIGHT) +
      cell('PageScale', 1) +
      cell('DrawingScale', 1) +
      cell('PrintPageOrientation', 2) +
      `</PageSheet><Rel r:id="rId1"/></Page></Pages>`,
    'visio/pages/_rels/pages.xml.rels':
      xml +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${REL}/page" Target="page1.xml"/>` +
      `</Relationships>`,
    'visio/pages/page1.xml': pageXml(t, width),
  };

  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])), { level: 6 });
}
