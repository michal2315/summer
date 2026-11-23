import { BadRequestException } from '@nestjs/common';
import JSZip from 'jszip';
import { checkDoc, PmNode } from './pouch-doc';
import { fontName, halfPoints, hexColor, imageSize, renderDocx } from './pouch-docx';

const PAGE = { orientation: 'portrait', margins: 'normal' } as const;

/** 1×1 transparent PNG. */
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const text = (t: string, marks?: PmNode['marks']): PmNode => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
const p = (...content: PmNode[]): PmNode => ({ type: 'paragraph', content });
const doc = (...content: PmNode[]): PmNode => ({ type: 'doc', content });

async function documentXml(d: PmNode, page: { orientation: 'portrait' | 'landscape'; margins: 'narrow' | 'normal' | 'wide' } = PAGE): Promise<string> {
  const zip = await JSZip.loadAsync(await renderDocx(d, page));
  return zip.file('word/document.xml')!.async('string');
}

describe('pouch docx helpers', () => {
  it('reads CSS colours as Word hex', () => {
    expect(hexColor('#abc')).toBe('AABBCC');
    expect(hexColor('#1f2a44')).toBe('1F2A44');
    expect(hexColor('#1f2a44ff')).toBe('1F2A44');
    expect(hexColor('rgb(255, 0, 16)')).toBe('FF0010');
    expect(hexColor('red')).toBeUndefined();
    expect(hexColor(undefined)).toBeUndefined();
  });

  it('reads font sizes as half-points', () => {
    expect(halfPoints('12pt')).toBe(24);
    expect(halfPoints('16px')).toBe(24);
    expect(halfPoints('10.5pt')).toBe(21);
    expect(halfPoints('huge')).toBeUndefined();
  });

  it('takes the first family of a font list', () => {
    expect(fontName('"Times New Roman", serif')).toBe('Times New Roman');
    expect(fontName('David')).toBe('David');
    expect(fontName('')).toBeUndefined();
  });

  it('reads PNG dimensions', () => {
    expect(imageSize(Buffer.from(PNG_1x1, 'base64'), 'png')).toEqual({ width: 1, height: 1 });
  });
});

describe('checkDoc', () => {
  it('accepts an editor document', () => {
    const d = doc(p(text('שלום', [{ type: 'bold' }])), { type: 'repeatBlock', content: [p({ type: 'field', attrs: { key: 'title', label: 'כותרת' } })] });
    expect(checkDoc(d)).toBe(d);
  });

  it('refuses unknown nodes, marks and non-doc roots', () => {
    expect(() => checkDoc(doc({ type: 'script' }))).toThrow(BadRequestException);
    expect(() => checkDoc(doc(p(text('x', [{ type: 'blink' }]))))).toThrow(BadRequestException);
    expect(() => checkDoc(p(text('x')))).toThrow(BadRequestException);
    expect(() => checkDoc('nope')).toThrow(BadRequestException);
  });

  it('refuses object-valued attributes', () => {
    expect(() => checkDoc(doc({ type: 'paragraph', attrs: { evil: { a: 1 } } }))).toThrow(BadRequestException);
  });

  it('refuses documents nested too deeply', () => {
    let node: PmNode = p(text('x'));
    for (let i = 0; i < 50; i++) node = { type: 'blockquote', content: [node] };
    expect(() => checkDoc(doc(node))).toThrow(BadRequestException);
  });
});

describe('renderDocx', () => {
  it('writes right-to-left paragraphs with their marks and styles', async () => {
    const xml = await documentXml(
      doc(
        p(
          text('מודגש', [{ type: 'bold' }]),
          text(' צבע', [{ type: 'textStyle', attrs: { color: '#ff0000', fontSize: '14pt', fontFamily: 'David' } }]),
          text('english'),
        ),
      ),
    );
    expect(xml).toContain('<w:bidi/>');
    expect(xml).toContain('מודגש');
    expect(xml).toMatch(/<w:b\/>/);
    expect(xml).toContain('w:val="FF0000"');
    expect(xml).toContain('w:val="28"');
    expect(xml).toContain('w:ascii="David"');
    // Hebrew runs are marked right-to-left; the Latin one isn't.
    expect(xml).toMatch(/<w:rtl\/>.*?מודגש/s);
    expect(xml).toMatch(/<w:r>(?:(?!<w:rtl\/>).)*?english/s);
  });

  it('maps alignment logically (left is the end of a right-to-left line)', async () => {
    const xml = await documentXml(
      doc(
        { type: 'paragraph', attrs: { textAlign: 'center' }, content: [text('a')] },
        { type: 'paragraph', attrs: { textAlign: 'left' }, content: [text('b')] },
        { type: 'paragraph', attrs: { textAlign: 'justify' }, content: [text('c')] },
      ),
    );
    expect(xml).toContain('<w:jc w:val="center"/>');
    expect(xml).toContain('<w:jc w:val="end"/>');
    expect(xml).toContain('<w:jc w:val="both"/>');
  });

  it('writes left-to-right paragraphs, and lists and quotes, without bidi and with mirrored alignment', async () => {
    const ltr = { dir: 'ltr' };
    const xml = await documentXml(
      doc(
        { type: 'paragraph', attrs: { ...ltr, textAlign: 'right' }, content: [text('end')] },
        { type: 'paragraph', attrs: { ...ltr, textAlign: 'left' }, content: [text('start')] },
        { type: 'blockquote', attrs: ltr, content: [p(text('quoted'))] },
        { type: 'bulletList', attrs: ltr, content: [{ type: 'listItem', content: [p(text('item'))] }] },
      ),
    );
    expect(xml).not.toContain('<w:bidi/>');
    const paras = xml.split('<w:p>').slice(1);
    expect(paras[0]).toContain('<w:jc w:val="end"/>');
    expect(paras[1]).not.toContain('<w:jc');
    // The page's right-to-left default still applies to the rest.
    expect(await documentXml(doc(p(text('x'))))).toContain('<w:bidi/>');
  });

  it('writes headings, lists, tables, rules, page breaks and links', async () => {
    const xml = await documentXml(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [text('כותרת')] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [p(text('נקודה'))] }] },
        { type: 'orderedList', content: [{ type: 'listItem', content: [p(text('ראשון'))] }, { type: 'listItem', content: [p(text('שני'))] }] },
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [{ type: 'tableHeader', content: [p(text('כותרת עמודה'))] }, { type: 'tableHeader', content: [p(text('ב'))] }] },
            { type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 2 }, content: [p(text('תא רחב'))] }] },
          ],
        },
        { type: 'horizontalRule' },
        { type: 'pageBreak' },
        p(text('קישור', [{ type: 'link', attrs: { href: 'https://example.com' } }])),
      ),
    );
    expect(xml).toContain('w:pStyle w:val="Heading2"');
    expect((xml.match(/<w:numPr>/g) ?? []).length).toBe(3);
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('<w:gridSpan w:val="2"/>');
    expect(xml).toContain('<w:br w:type="page"/>');
    expect(xml).toContain('<w:hyperlink');
    expect(xml).toContain('כותרת עמודה');
  });

  it('restarts numbering for each ordered list', async () => {
    const list = (t: string): PmNode => ({ type: 'orderedList', content: [{ type: 'listItem', content: [p(text(t))] }] });
    const xml = await documentXml(doc(list('א'), p(text('בין')), list('ב')));
    const numIds = [...xml.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]);
    expect(numIds).toHaveLength(2);
    expect(numIds[0]).not.toBe(numIds[1]);
  });

  it('embeds data-URL images and replaces others with their alt text', async () => {
    const zip = await JSZip.loadAsync(
      await renderDocx(
        doc({ type: 'image', attrs: { src: `data:image/png;base64,${PNG_1x1}`, alt: 'נקודה' } }, { type: 'image', attrs: { src: 'https://example.com/x.png', alt: 'רחוקה' } }),
        PAGE,
      ),
    );
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(Object.keys(zip.files).some((f) => f.startsWith('word/media/'))).toBe(true);
    expect(xml).toContain('<w:drawing>');
    expect(xml).toContain('[רחוקה]');
  });

  it('flattens the repeat block and shows leftover fields as labels', async () => {
    const xml = await documentXml(doc({ type: 'repeatBlock', content: [p({ type: 'field', attrs: { key: 'title', label: 'כותרת' } })] }));
    expect(xml).toContain('«כותרת»');
  });

  it('sets landscape pages and margins', async () => {
    const xml = await documentXml(doc(p(text('x'))), { orientation: 'landscape', margins: 'narrow' });
    expect(xml).toContain('w:orient="landscape"');
    expect(xml).toMatch(/<w:pgMar [^>]*w:top="720"/);
  });

  it('renders an empty document', async () => {
    const xml = await documentXml(doc());
    expect(xml).toContain('<w:body>');
  });
});
