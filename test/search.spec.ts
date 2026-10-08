import { extractNameSearch, filterByName, normalizeSearchText } from '../modules/search';

const MUNICIPALITIES = [
  { id: 41, name: 'Širvintų r. sav.' },
  { id: 13, name: 'Vilniaus m. sav.' },
  { id: 41, name: 'Vilniaus r. sav.' },
  { id: 33, name: 'Šiaulių m. sav.' },
];

describe('search', () => {
  it('ignores diacritics and case', () => {
    expect(normalizeSearchText('  ŠIRVINTŲ ')).toBe('sirvintu');
  });

  it('finds municipalities typed without Lithuanian letters', () => {
    expect(filterByName(MUNICIPALITIES, 'sirvintu').map((m) => m.name)).toEqual([
      'Širvintų r. sav.',
    ]);
    expect(filterByName(MUNICIPALITIES, 'siaul').map((m) => m.name)).toEqual(['Šiaulių m. sav.']);
    expect(filterByName(MUNICIPALITIES, 'vilniaus')).toHaveLength(2);
  });

  it('returns everything for an empty search', () => {
    expect(filterByName(MUNICIPALITIES, '')).toHaveLength(MUNICIPALITIES.length);
  });

  it('reads the term from search or from the admin ilike filter', () => {
    expect(extractNameSearch({ search: 'vil' })).toBe('vil');
    expect(extractNameSearch({ query: '{"name":{"$ilike":"%šiaul%"}}' })).toBe('šiaul');
    expect(extractNameSearch({ query: { name: { $ilike: '%%' } } })).toBe('');
    expect(extractNameSearch({ query: 'not json' })).toBe('');
    expect(extractNameSearch({})).toBe('');
  });
});
