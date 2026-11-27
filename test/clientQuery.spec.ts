'use strict';

import {
  andCondition,
  isSafeSortField,
  isSqlSafeJson,
  omitQueryFields,
  parseQuery,
  scopeCondition,
  searchCondition,
} from '../modules/clientQuery';
import { COMMON_SCOPES } from '../types';

describe('parseQuery', () => {
  it('reads a JSON string and copies an object', () => {
    const query = { permit: 1 };

    expect(parseQuery('{"permit":1}')).toEqual({ permit: 1 });
    expect(parseQuery(query)).toEqual(query);
    expect(parseQuery(query)).not.toBe(query);
  });

  it.each([undefined, null, '', 5, true, [], [{ a: 1 }], '[1,2]', '"text"', 'null'])(
    'treats %j as an empty query',
    (value) => {
      expect(parseQuery(value)).toEqual({});
    },
  );

  it('rejects a string that is not JSON', () => {
    expect(() => parseQuery('{not-json')).toThrow(
      expect.objectContaining({ code: 422, type: 'INVALID_QUERY' }),
    );
  });
});

describe('andCondition', () => {
  const access = { user: 5 };

  it('keeps the other conditions and adds the condition to $and', () => {
    expect(andCondition({ permit: 1 }, access)).toEqual({ permit: 1, $and: [access] });
    expect(andCondition('{"permit":1}', access)).toEqual({ permit: 1, $and: [access] });
    expect(andCondition(undefined, access)).toEqual({ $and: [access] });
  });

  // Kliento raktas tuo pačiu pavadinimu sąlygos neperrašo: abi sąlygos galioja kartu.
  it('does not let a key of the query replace the condition', () => {
    const values: unknown[] = [6, [], { $exists: true }, null];
    for (const user of values) {
      expect(andCondition({ user }, access)).toEqual({ user, $and: [access] });
    }
  });

  it('keeps conditions that are already in $and', () => {
    const first = andCondition({ $and: [{ permit: 1 }] }, access);

    expect(first.$and).toEqual([{ permit: 1 }, access]);
    expect(andCondition(first, { tenant: 2 }).$and).toEqual([{ permit: 1 }, access, { tenant: 2 }]);
  });

  it.each([{ user: [] }, 'text', 5, null])('replaces a $and that is not a list (%j)', ($and) => {
    expect(andCondition({ $and }, access)).toEqual({ $and: [access] });
  });

  it('does not change the query it was given', () => {
    const query = { $and: [{ permit: 1 }] };
    andCondition(query, access);

    expect(query).toEqual({ $and: [{ permit: 1 }] });
  });
});

describe('scopes', () => {
  const notDeleted = { deletedAt: { $exists: false } };

  it('adds the scope next to a client condition on the same field', () => {
    expect(scopeCondition(notDeleted)({ deletedAt: [] })).toEqual({
      deletedAt: [],
      $and: [notDeleted],
    });
    expect(COMMON_SCOPES.notDeleted({ deletedAt: [] })).toEqual({
      deletedAt: [],
      $and: [notDeleted],
    });
  });

  it.each([['deleted'], 'deleted', '-notDeleted,deleted', 'deleted other'])(
    'leaves notDeleted out when the deleted scope is asked for (%j)',
    (scope) => {
      expect(COMMON_SCOPES.notDeleted({ permit: 1 }, undefined, { scope })).toEqual({ permit: 1 });
    },
  );

  it.each([undefined, null, true, [], ['other'], 'undeleted'])(
    'applies notDeleted for any other scope (%j)',
    (scope) => {
      expect(COMMON_SCOPES.notDeleted({}, undefined, { scope })).toEqual({ $and: [notDeleted] });
    },
  );

  it('the deleted scope returns only deleted rows', () => {
    expect(COMMON_SCOPES.deleted({})).toEqual({ $and: [{ deletedAt: { $exists: true } }] });
  });
});

describe('searchCondition', () => {
  const fields = [
    { name: 'permitNumber', columnName: 'permitNumber' },
    { name: 'issuer', columnName: 'issuerId' },
    { name: 'address' },
    { name: 'status', virtual: true },
  ];
  const like = (column: string, text = 'abc') => ({
    $raw: { condition: '?? like ?', bindings: [column, `%${text}%`] },
  });

  it('builds one grouped condition over the given fields', () => {
    expect(searchCondition(fields, 'abc', ['permitNumber', 'address'])).toEqual({
      $or: [like('permitNumber'), like('address')],
    });
  });

  it('accepts the fields as a comma or space separated string', () => {
    expect(searchCondition(fields, 'abc', 'permitNumber,address')).toEqual({
      $or: [like('permitNumber'), like('address')],
    });
    expect(searchCondition(fields, 'abc', 'permitNumber address')).toEqual({
      $or: [like('permitNumber'), like('address')],
    });
  });

  it('uses the column of a field and lists it once', () => {
    expect(searchCondition(fields, 'abc', ['issuer', 'issuer'])).toEqual({
      $or: [like('issuerId')],
    });
  });

  it('skips unknown and virtual fields', () => {
    expect(searchCondition(fields, 'abc', ['status', 'noSuchField', 'address'])).toEqual({
      $or: [like('address')],
    });
    expect(searchCondition(fields, 'abc', ['status', 'noSuchField'])).toBeUndefined();
  });

  it.each([
    [undefined, ['address']],
    ['', ['address']],
    [5, ['address']],
    ['abc', undefined],
    ['abc', []],
    ['abc', [{ name: 'address' }]],
  ])('builds nothing for search %j in fields %j', (search, searchFields) => {
    expect(searchCondition(fields, search, searchFields)).toBeUndefined();
  });

  it('builds nothing when the service has no fields', () => {
    expect(searchCondition(undefined, 'abc', ['address'])).toBeUndefined();
  });
});

describe('isSqlSafeJson', () => {
  it.each([
    [{ name: 'Vilniaus m. sav.', id: 13 }],
    [{ name: { $in: ['a', 'b'] }, nested: [{ ok: true, n: null }] }],
    ['Širvintų r. sav. "kabutėse"'],
    [5],
    [null],
    [undefined],
    [[]],
  ])('accepts %j', (value) => {
    expect(isSqlSafeJson(value)).toBe(true);
  });

  it.each([
    ["x' OR TRUE"],
    ['x\\'],
    ['a?b'],
    ['x\u0000'],
    [{ name: "x'" }],
    [{ "x'": 1 }],
    [{ deep: [{ deeper: { name: ["x'"] } }] }],
    [['ok', { 'a\\': 1 }]],
  ])('refuses %j', (value) => {
    expect(isSqlSafeJson(value)).toBe(false);
  });
});

describe('isSafeSortField', () => {
  it.each(['name', '-createdAt', 'speciesClassifier.name', '-municipality.name', 'a_b.c1.d'])(
    'accepts %s',
    (field) => {
      expect(isSafeSortField(field)).toBe(true);
    },
  );

  it.each([
    "permits.a'||(SELECT 1)::text||'",
    '&random()',
    'name desc',
    'name;',
    '--name',
    '.name',
    'name.',
    'a..b',
    '',
    5,
    null,
    ['name'],
  ])('refuses %j', (field) => {
    expect(isSafeSortField(field)).toBe(false);
  });
});

describe('omitQueryFields', () => {
  const hidden = ['deletedAt', 'deletedBy'];

  it('removes the fields at any depth and keeps the rest', () => {
    const query = {
      permitNumber: 'A-1',
      deletedBy: 5,
      $and: [{ users: [1] }, { deletedAt: { $exists: true }, type: 'ZOO' }],
      $or: [{ deletedBy: 7 }, { municipality: { id: 13, deletedAt: '2026-01-01' } }],
    };

    expect(omitQueryFields(query, hidden)).toEqual({
      permitNumber: 'A-1',
      $and: [{ users: [1] }, { type: 'ZOO' }],
      $or: [{}, { municipality: { id: 13 } }],
    });
  });

  it('does not change the query it was given', () => {
    const query = { deletedBy: 5, $and: [{ deletedAt: 1 }] };
    omitQueryFields(query, hidden);

    expect(query).toEqual({ deletedBy: 5, $and: [{ deletedAt: 1 }] });
  });

  it.each([undefined, null, 5, 'text', true])('returns %j as it is', (value) => {
    expect(omitQueryFields(value, hidden)).toBe(value);
  });

  it('leaves values that are not plain objects alone', () => {
    const date = new Date('2026-01-01');

    expect(omitQueryFields({ issueDate: { $gte: date } }, hidden)).toEqual({
      issueDate: { $gte: date },
    });
  });
});
