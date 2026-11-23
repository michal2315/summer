import { strFromU8, unzipSync } from 'fflate';
import { buildTimelineVsdx, hexColor } from './timeline-vsdx';

describe('buildTimelineVsdx', () => {
  const parts = () =>
    unzipSync(
      buildTimelineVsdx({
        title: 'ציר <בדיקה> & "עוד"',
        accent: '#FF7EB9',
        items: [
          { date: '01/01/2026', title: 'תמצית ראשונה', color: '#0a0', custom: false, link: 'https://x.test/summaries?summaryId=1&a=b' },
          { date: '02/01/2026', title: 'אירוע\u0007', custom: true },
        ],
      }),
    );

  it('packages every part Visio needs', () => {
    expect(Object.keys(parts()).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/app.xml',
      'docProps/core.xml',
      'visio/_rels/document.xml.rels',
      'visio/document.xml',
      'visio/pages/_rels/pages.xml.rels',
      'visio/pages/page1.xml',
      'visio/pages/pages.xml',
    ]);
  });

  it('writes well-formed XML, with titles escaped', () => {
    for (const [name, data] of Object.entries(parts())) {
      const doc = new DOMParser().parseFromString(strFromU8(data), 'application/xml');
      expect(doc.getElementsByTagName('parsererror').length).withContext(name).toBe(0);
    }
  });

  it('draws a title, the line, and a card + dot per item', () => {
    const page = new DOMParser().parseFromString(strFromU8(parts()['visio/pages/page1.xml']), 'application/xml');
    const names = Array.from(page.getElementsByTagName('Shape')).map((s) => s.getAttribute('NameU'));
    expect(names).toEqual(['Title', 'Line', 'Summary', 'Dot', 'Event', 'Dot']);
    const texts = Array.from(page.getElementsByTagName('Text')).map((t) => t.textContent);
    expect(texts).toEqual(['ציר <בדיקה> & "עוד"', '01/01/2026\nתמצית ראשונה', '02/01/2026\nאירוע']);
  });

  it('places the earliest item on the right (RTL)', () => {
    const page = new DOMParser().parseFromString(strFromU8(parts()['visio/pages/page1.xml']), 'application/xml');
    const pinX = (name: string) =>
      Number(
        Array.from(page.getElementsByTagName('Shape'))
          .find((s) => s.getAttribute('NameU') === name)!
          .querySelector('Cell[N="PinX"]')!
          .getAttribute('V'),
      );
    expect(pinX('Summary')).toBeGreaterThan(pinX('Event'));
  });
});

describe('hexColor', () => {
  it('normalizes hex colors and rejects anything else', () => {
    expect(hexColor(' #0a0 ')).toBe('#00AA00');
    expect(hexColor('#ff7eb9')).toBe('#FF7EB9');
    expect(hexColor('red')).toBeNull();
    expect(hexColor(undefined)).toBeNull();
  });
});
