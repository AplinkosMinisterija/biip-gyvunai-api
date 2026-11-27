import { Errors } from 'moleculer';

export type Query = Record<string, unknown>;

export function throwInvalidQuery(): never {
  throw new Errors.MoleculerClientError('Invalid query', 422, 'INVALID_QUERY');
}

// `query` iš kliento ateina kaip objektas (`?query[laukas]=1`) arba kaip JSON eilutė
// (`?query={"laukas":1}`); vidiniai kvietimai perduoda objektą.
export const parseQuery = (query: unknown): Query => {
  let parsed = query;

  if (typeof query === 'string' && query.trim() !== '') {
    try {
      parsed = JSON.parse(query);
    } catch (err) {
      throwInvalidQuery();
    }
  }

  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...parsed } : {};
};

// Prideda sąlygą, kurios kita užklausos dalis negali nei pakeisti, nei išjungti. Sąlyga dedama
// į viršutinį `$and`, o ne šalia kitų raktų: to paties lauko raktą kliento užklausa perrašytų,
// o `@moleculer/database` masyvo reikšmės lauke (pvz. `{"deletedAt": []}`) iš viso nepaiso.
export const andCondition = (query: unknown, condition: Query): Query => {
  const parsed = parseQuery(query);
  const conditions = Array.isArray(parsed.$and) ? parsed.$and : [];

  return { ...parsed, $and: [...conditions, condition] };
};

// `settings.scopes` sritis kaip funkcija: objekto sritį biblioteka su užklausa sulieja per
// `_.merge`, todėl kliento masyvas tame pačiame rakte ją išjungtų.
export const scopeCondition = (condition: Query) => (query: unknown) =>
  andCondition(query, condition);

// Kelios bibliotekos (`moleculer-accounts` JSON laukų sąlygos, `moleculer-postgis` geometrija)
// kliento JSON į SQL įterpia kaip tekstą viengubose kabutėse ir ne visur jį ekranuoja. Toks JSON
// saugus tik tada, kai nė viename jo rakte ar tekstinėje reikšmėje nėra viengubos kabutės,
// pasvirojo brūkšnio ar nulinio simbolio. Klaustukas atmetamas todėl, kad taip sudarytame SQL
// tekste knex jį laiko parametro vieta ir užklausa baigiasi serverio klaida.
const UNSAFE_SQL_TEXT = /['\\?\u0000]/;

export const isSqlSafeJson = (value: unknown): boolean => {
  if (typeof value === 'string') return !UNSAFE_SQL_TEXT.test(value);
  if (Array.isArray(value)) return value.every(isSqlSafeJson);
  if (value && typeof value === 'object') {
    return Object.entries(value).every(([key, item]) => isSqlSafeJson(key) && isSqlSafeJson(item));
  }

  return true;
};

// Rikiavimo laukas (ir kelias iki JSON savybės): tik raidės, skaitmenys, `_` ir taškai.
export const isSafeSortField = (item: unknown): boolean =>
  typeof item === 'string' && /^-?[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/.test(item);

// Pašalina nurodytus laukus iš užklausos bet kuriame gylyje (taip pat `$and` ir `$or` viduje):
// lauko, kurio naudotojas nemato, jis neturi galėti atspėti ir filtruodamas.
export const omitQueryFields = (value: unknown, fields: readonly string[]): unknown => {
  if (Array.isArray(value)) return value.map((item) => omitQueryFields(item, fields));
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !fields.includes(key))
      .map(([key, item]) => [key, omitQueryFields(item, fields)]),
  );
};

type SearchableField = { name: string; columnName?: string; virtual?: boolean };

const toList = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value])
    .filter((item): item is string => typeof item === 'string')
    .flatMap((item) => item.split(/[,\s]+/))
    .filter(Boolean);

// Paieškos sąlyga: tekstas bent viename iš nurodytų laukų (kaip `@moleculer/database` — `like`).
// Laukai, kurių lentelėje nėra (nežinomi ar virtualūs), praleidžiami.
export const searchCondition = (
  fields: SearchableField[] | undefined,
  search: unknown,
  searchFields: unknown,
): Query | undefined => {
  if (typeof search !== 'string' || search === '') return undefined;

  const columns = toList(searchFields)
    .map((name) => fields?.find((field) => field.name === name && !field.virtual))
    .filter((field): field is SearchableField => !!field)
    .map((field) => field.columnName || field.name);
  if (!columns.length) return undefined;

  return {
    $or: [...new Set(columns)].map((column) => ({
      $raw: { condition: '?? like ?', bindings: [column, `%${search}%`] },
    })),
  };
};
