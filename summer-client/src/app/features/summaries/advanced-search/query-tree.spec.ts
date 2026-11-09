import { IQueryGroup, SearchType } from '../../../shared/models';
import { regexFor } from '../../../shared/pipes/highlight';
import { searchFromParams, searchToParams } from '../search-query';
import { addChild, countConditions, newCondition, newGroup, querySentence, removeNode, toEditable, toQuery, updateNode } from './query-tree';

describe('query tree', () => {
  const tree: IQueryGroup = {
    type: 'group',
    op: 'AND',
    children: [
      { type: 'cond', field: 'title', op: 'all', words: ['גרף'] },
      {
        type: 'group',
        op: 'OR',
        children: [
          { type: 'cond', field: 'contentType', op: 'isOneOf', values: ['lecture'] },
          { type: 'cond', field: 'content', op: 'none', words: ['מבחן'] },
        ],
      },
    ],
  };

  it('round-trips through the editable form, dropping empty conditions and groups', () => {
    let g = toEditable(tree);
    expect(toQuery(g)).toEqual(tree);

    g = addChild(g, g.id, newCondition('author')); // no values yet
    g = addChild(g, g.id, newGroup());
    expect(toQuery(g)).toEqual(tree);
    expect(toQuery(newGroup())).toBeUndefined();
  });

  it('edits and removes nodes by id without touching the rest', () => {
    const g = toEditable(tree);
    const inner = g.children[1];
    const flipped = updateNode(g, inner.id, { op: 'AND' });
    expect((toQuery(flipped)!.children[1] as IQueryGroup).op).toBe('AND');
    expect(countConditions(toQuery(removeNode(g, inner.id))!)).toBe(1);
  });

  it('reads the query back as a sentence, bracketing nested groups', () => {
    const text = querySentence(tree, (field, v) => (field === 'contentType' ? 'שיעור' : v))
      .map((p) => p.text)
      .join(' ');
    expect(text).toBe('מכילות את "גרף" בכותרת וגם ( מסוג שיעור או לא מכילות "מבחן" בתוכן התמצית )');
  });

  it('survives the URL and ignores a broken adv param', () => {
    const params = Object.fromEntries(Object.entries(searchToParams({ query: tree })).filter(([, v]) => v !== null));
    expect(searchFromParams(params).query).toEqual(tree);
    expect(searchFromParams({ adv: '{oops' }).query).toBeUndefined();
  });

  it('highlights the words a field must contain, not excluded ones', () => {
    const re = regexFor({ query: tree }, SearchType.Title)!;
    expect('גרף ומבחן'.match(re)).toEqual(['גרף']);
    expect(regexFor({ query: tree }, SearchType.Content)).toBeNull();
  });
});
