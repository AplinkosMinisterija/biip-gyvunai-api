import { isPlainObject } from 'lodash';

// Paieška be diakritikos ir didžiųjų raidžių: „sirvintu“ randa „Širvintų r. sav.“.
export const normalizeSearchText = (value?: string) =>
  (value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

const parseQuery = (query: unknown) => {
  if (typeof query !== 'string') return query;
  try {
    return JSON.parse(query);
  } catch (err) {
    return undefined;
  }
};

// Paieškos tekstas iš `search` arba administravimo filtro `query.name.$ilike` (`%tekstas%`).
export const extractNameSearch = (params: { search?: unknown; query?: unknown }) => {
  if (typeof params?.search === 'string') return params.search;

  const query = parseQuery(params?.query);
  if (!isPlainObject(query)) return '';

  const name = (query as { name?: unknown }).name;
  if (typeof name === 'string') return name;

  const ilike = isPlainObject(name) ? (name as { $ilike?: unknown }).$ilike : undefined;
  return typeof ilike === 'string' ? ilike.replace(/%/g, '') : '';
};

export const filterByName = <T extends { name: string }>(items: T[], search: string) => {
  const term = normalizeSearchText(search);
  if (!term) return items;

  return items.filter((item) => normalizeSearchText(item.name).includes(term));
};
