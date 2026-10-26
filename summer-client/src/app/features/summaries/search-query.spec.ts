import { ISummarySearch, SearchType } from '../../shared/models';
import { activeFilterCount, searchFromParams, searchToParams } from './search-query';

describe('search query params', () => {
  it('round-trips a full search through the URL', () => {
    const search: ISummarySearch = {
      text: 'גרפים "מסלול קצר"',
      searchTypes: [SearchType.Title, SearchType.Label],
      contentTypes: ['lecture', 'video'],
      colors: ['#ff0000'],
      users: ['u2'],
      labels: ['מועד א׳'],
      collections: ['c1'],
      dates: ['2026-10-01T00:00:00.000Z', '2026-10-20T00:00:00.000Z'],
      createdDates: undefined,
      sort: 'title',
      query: undefined,
    };
    const params = Object.fromEntries(Object.entries(searchToParams(search)).filter(([, v]) => v !== null));
    expect(searchFromParams(params)).toEqual(search);
  });

  it('clears keys that are empty and omits the default sort', () => {
    const params = searchToParams({ text: '  ', sort: '-eventDate', colors: [] });
    expect(params['q']).toBeNull();
    expect(params['sort']).toBeNull();
    expect(params['colors']).toBeNull();
  });

  it('counts active advanced filters', () => {
    expect(activeFilterCount({ text: 'x' })).toBe(0);
    expect(activeFilterCount({ colors: ['#ff0000'], users: ['u1'], dates: [] })).toBe(2);
  });
});
