import { MARK as M, QueryGroup, capsuleRefs, colorValue, parseQuery, summarySearchSchema } from './summary-search';

describe('search query', () => {
  const terms = (text: string) => parseQuery(text).groups.map((g) => g.map((t) => (t.neg ? '-' : '') + t.term));

  it('keeps quoted phrases, splits words, searches unmarked syntax as typed', () => {
    expect(terms('"שאלה ממבחן" #חשוב  graph or a:b')).toEqual([['שאלה ממבחן', '#חשוב', 'graph', 'or', 'a:b']]);
    expect(terms('')).toEqual([]);
    expect(terms('   ')).toEqual([]);
  });

  it('reads marked and / or / not in English and Hebrew, AND binding tighter than OR', () => {
    expect(terms(`a b ${M}OR c ${M}and ${M}not d`)).toEqual([['a', 'b'], ['c', '-d']]);
    expect(terms(`ביולוגיה ${M}או כימיה ${M}ולא מבחן`)).toEqual([['ביולוגיה'], ['כימיה', '-מבחן']]);
    expect(terms(`גרף ${M}לא מכוון`)).toEqual([['גרף', '-מכוון']]);
    expect(terms(`a ${M}בלי b ${M}ובלי c ${M}גם d`)).toEqual([['a', '-b', '-c', 'd']]);
  });

  it('drops operators that are not between terms, and searches quoted ones as words', () => {
    expect(terms(`${M}or a ${M}and`)).toEqual([['a']]);
    expect(terms(`a ${M}not`)).toEqual([['a']]);
    expect(terms(`a ${M}or ${M}or b`)).toEqual([['a'], ['b']]);
    expect(terms('"לא" ברור')).toEqual([['לא', 'ברור']]);
  });

  it('reads @user and :field:value as terms of their field, `_` for spaces, a space ending the value', () => {
    expect(parseQuery(`biology ${M}@Michal ${M}:כותב:Michal_Golan ${M}:title:"intro bio" ${M}or chemistry`).groups).toEqual([
      [
        { term: 'biology', neg: false },
        { term: 'Michal', field: 'author', neg: false },
        { term: 'Michal Golan', field: 'author', neg: false },
        { term: 'intro bio', exact: true, field: 'title', neg: false },
      ],
      [{ term: 'chemistry', neg: false }],
    ]);
    expect(terms(`${M}:nofield:x y`)).toEqual([['y']]);
  });

  it('reads field names in any case and in Hebrew, and skips unfinished fields and bare sigils', () => {
    expect(parseQuery(`${M}:TITLE:x ${M}:תווית:מועד_א ${M}:צבע:אדום`).groups).toEqual([
      [
        { term: 'x', field: 'title', neg: false },
        { term: 'מועד א', field: 'labels', neg: false },
        { term: 'אדום', field: 'color', neg: false },
      ],
    ]);
    expect(terms(`${M}:title: ${M}:title ${M}@ ${M}# y`)).toEqual([['y']]);
  });

  it('negates a field term with not', () => {
    expect(parseQuery(`a ${M}not ${M}:type:lecture`).groups).toEqual([
      [
        { term: 'a', neg: false },
        { term: 'lecture', field: 'type', neg: true },
      ],
    ]);
  });

  it('reads at most 10 terms', () => {
    const words = Array.from({ length: 15 }, (_, i) => `w${i}`);
    expect(parseQuery(words.join(' ')).groups[0]).toHaveLength(10);
    expect(parseQuery(words.join(` ${M}or `)).groups).toHaveLength(10);
  });

  it('marks #name terms as capsule references, from the text and the advanced tree', () => {
    const q = parseQuery(`${M}#חשוב_למבחן ${M}או ${M}לא ${M}#עצים "#מצוטט"`);
    expect(q.capsules).toEqual(['חשוב_למבחן', 'עצים']);
    expect(q.groups).toEqual([
      [{ term: 'חשוב_למבחן', neg: false, capsule: true }],
      [
        { term: 'עצים', neg: true, capsule: true },
        { term: '#מצוטט', neg: false, exact: true },
      ],
    ]);
    expect(parseQuery(`${M}#עצים ${M}or ${M}#עצים`).capsules).toEqual(['עצים']);
    const tree: QueryGroup = {
      type: 'group',
      op: 'AND',
      children: [
        { type: 'cond', field: 'text', op: 'any', words: ['#cap:cap-trees', 'גרף'], values: [] },
        { type: 'group', op: 'OR', children: [{ type: 'cond', field: 'title', op: 'all', words: ['#cap:cap-graphs'], values: [] }] },
      ],
    };
    expect(capsuleRefs({ text: `${M}#גרפים`, query: tree })).toEqual({ ids: ['cap-trees', 'cap-graphs'], names: ['גרפים'] });
    expect(capsuleRefs({ text: '#גרפים' })).toEqual({ ids: [], names: [] });
  });
});

describe('search colors', () => {
  it('reads palette names in Hebrew and English, and hex codes', () => {
    expect(colorValue('אדום')).toBe('#ff0000');
    expect(colorValue(' Red ')).toBe('#ff0000');
    expect(colorValue('טורקיז')).toBe('#00b2b2');
    expect(colorValue('FE9EAE')).toBe('#fe9eae');
    expect(colorValue('#808080')).toBe('#808080');
  });

  it('names no color otherwise', () => {
    expect(colorValue('צהוב')).toBeUndefined();
    expect(colorValue('#abc')).toBeUndefined();
    expect(colorValue('')).toBeUndefined();
  });
});

describe('search request', () => {
  const ID = '0F8FAD5B-D9CB-469F-A165-70867728950E';
  const ok = (v: object) => summarySearchSchema.safeParse(v).success;
  const cond = (c: object) => ({ type: 'cond', field: 'text', op: 'any', words: ['x'], ...c });
  const tree = (...children: object[]) => ({ type: 'group', op: 'AND', children });

  it('fills defaults and reads query-string lists', () => {
    expect(summarySearchSchema.parse({})).toEqual(
      expect.objectContaining({ text: '', sort: '-eventDate', skip: 0, limit: 20, summarySearch: 'SUMMARY', isProfile: false, noFolder: false, colors: [], users: [] }),
    );
    expect(summarySearchSchema.parse({}).query).toBeUndefined();
    const s = summarySearchSchema.parse({ colors: '#ff0000, #0000c9', labels: ['a', 'b,c'], users: ID, skip: '40', limit: '10', isProfile: 'true', extra: 1 });
    expect(s).toEqual(expect.objectContaining({ colors: ['#ff0000', '#0000c9'], labels: ['a', 'b', 'c'], users: [ID.toLowerCase()], skip: 40, limit: 10, isProfile: true }));
    expect(s).not.toHaveProperty('extra');
  });

  it('rejects out-of-range paging, unknown enums and bad ids', () => {
    expect(ok({ limit: 101 })).toBe(false);
    expect(ok({ limit: 0 })).toBe(false);
    expect(ok({ skip: -1 })).toBe(false);
    expect(ok({ sort: 'size' })).toBe(false);
    expect(ok({ searchTypes: 'TITLE,BODY' })).toBe(false);
    expect(ok({ summarySearch: 'TRASH' })).toBe(false);
    expect(ok({ users: 'u1' })).toBe(false);
    expect(ok({ text: 'x'.repeat(201) })).toBe(false);
  });

  it('reads the advanced tree from a JSON string or an object', () => {
    const q = tree(cond({}));
    expect(summarySearchSchema.parse({ query: JSON.stringify(q) }).query).toEqual({ ...q, children: [{ ...q.children[0], values: [] }] });
    expect(summarySearchSchema.parse({ query: q }).query?.children).toHaveLength(1);
    expect(summarySearchSchema.parse({ query: ' ' }).query).toBeUndefined();
    expect(ok({ query: '{nope' })).toBe(false);
  });

  it('limits the tree to 4 levels and 30 conditions', () => {
    const nest = (depth: number): object => (depth === 1 ? tree(cond({})) : tree(nest(depth - 1)));
    expect(ok({ query: nest(4) })).toBe(true);
    expect(ok({ query: nest(5) })).toBe(false);
    const many = (n: number) => tree(...Array.from({ length: n }, () => cond({})));
    expect(ok({ query: tree(many(15), many(15)) })).toBe(true);
    expect(ok({ query: tree(many(15), many(16)) })).toBe(false);
  });

  it('checks each condition’s operator against its field', () => {
    const q = (c: object) => ok({ query: tree(cond(c)) });
    expect(q({ field: 'title', op: 'none' })).toBe(true);
    expect(q({ field: 'title', op: 'isOneOf' })).toBe(false);
    expect(q({ field: 'color', op: 'isOneOf', values: ['#ff0000'] })).toBe(true);
    expect(q({ field: 'eventDate', op: 'between', from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' })).toBe(true);
    expect(q({ field: 'eventDate', op: 'all' })).toBe(false);
    expect(q({ field: 'author', op: 'isOneOf', values: [ID] })).toBe(true);
    expect(q({ field: 'author', op: 'isOneOf', values: ['dlevi'] })).toBe(false);
    expect(q({ field: 'folder', op: 'isNot', values: ['f1'] })).toBe(false);
  });

  it('needs a catalog field’s id, and numbers for its number bounds', () => {
    const q = (c: object) => ok({ query: tree(cond({ field: 'field', ...c })) });
    expect(q({ fieldId: ID, op: 'all' })).toBe(true);
    expect(q({ op: 'all' })).toBe(false);
    expect(q({ fieldId: ID, op: 'range', from: '1', to: '2.5' })).toBe(true);
    expect(q({ fieldId: ID, op: 'gt', from: '' })).toBe(true);
    expect(q({ fieldId: ID, op: 'lt', to: 'ten' })).toBe(false);
  });
});
