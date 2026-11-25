'use strict';

import { Knex } from 'knex';
import { knex } from '../helpers/testBroker';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const migration = require('../../database/migrations/20261123120000_removeTestPermit.js');

// Migracija keičia leidimų duomenis ir atnaujina viešus rodinius, todėl kiekvienas atvejis
// vyksta transakcijoje, kuri pabaigoje atšaukiama.
let trx: Knex.Transaction;

const TEST_NUMBER = 'Test Kristina';
const TEST_ISSUE_DATE = '2025-11-03T22:00:00Z';

const insertId = (row: any) => Number(typeof row === 'object' ? row.id : row);

const insert = async (table: string, row: Record<string, unknown>): Promise<number> => {
  const [created] = await trx(table)
    .insert({ createdAt: new Date(), ...row })
    .returning('id');
  return insertId(created);
};

const deletedAtOf = async (table: string, id: number) =>
  (await trx(table).where({ id }).first('deletedAt')).deletedAt;

const permit = (permitNumber: string, issueDate: string, deletedAt: Date | null = null) =>
  insert('permits', {
    permitNumber,
    issueDate: new Date(issueDate),
    issuerId: 1,
    type: 'AVIARY',
    cadastralIds: JSON.stringify([{ cadastral_number: `CAD-${permitNumber}-${issueDate}` }]),
    deletedAt,
  });

// Kaip produkcijoje: gyvūnas gali neturėti `permitId` ir būti susietas tik per rūšį.
const permitData = async (permitId: number) => {
  const species = await insert('species', {
    permitId,
    speciesClassifierId: 1,
    possessionType: 'WITH_PERMIT',
    type: 'INDIVIDUAL',
    amount: 2,
  });
  const animal = await insert('animals', { permitId, speciesId: species, gender: 'MALE' });
  const speciesOnlyAnimal = await insert('animals', { speciesId: species, gender: 'FEMALE' });
  return {
    species: [['species', species]],
    animals: [
      ['animals', animal],
      ['animals', speciesOnlyAnimal],
    ],
    other: [
      ['permitSpecies', await insert('permitSpecies', { permitId, speciesClassifierId: 1 })],
      ['records', await insert('records', { animalId: animal, type: 'BIRTH', date: new Date() })],
      [
        'records',
        await insert('records', { animalId: speciesOnlyAnimal, type: 'BIRTH', date: new Date() }),
      ],
      ['records', await insert('records', { speciesId: species, type: 'OTHER', date: new Date() })],
      ['records', await insert('records', { permitId, type: 'OTHER', date: new Date() })],
    ],
  };
};

const rowsOf = (data: Awaited<ReturnType<typeof permitData>>) =>
  [...data.species, ...data.animals, ...data.other] as [string, number][];

const cadastralRows = () =>
  trx('publicPermitsByCadastralIds').whereIn('cadastralNumber', [
    `CAD-${TEST_NUMBER}-${TEST_ISSUE_DATE}`,
  ]);

describe('migration: remove the test permit', () => {
  const earlierDeletedAt = new Date('2026-01-01T08:00:00Z');
  let testPermit: number;
  let testData: Awaited<ReturnType<typeof permitData>>;
  let earlierDeletedRecord: number;
  let sameNumberOtherDate: number;
  let otherPermit: number;
  let otherData: Awaited<ReturnType<typeof permitData>>;

  beforeAll(async () => {
    trx = await knex.transaction();
    await trx.raw('TRUNCATE records, animals, species, permit_species, permit_histories, permits');

    testPermit = await permit(TEST_NUMBER, TEST_ISSUE_DATE);
    testData = await permitData(testPermit);
    earlierDeletedRecord = await insert('records', {
      animalId: testData.animals[0][1],
      type: 'OTHER',
      date: new Date(),
      deletedAt: earlierDeletedAt,
    });

    sameNumberOtherDate = await permit(TEST_NUMBER, '2025-12-01T22:00:00Z');
    otherPermit = await permit('G1-1', TEST_ISSUE_DATE);
    otherData = await permitData(otherPermit);

    await trx.raw('REFRESH MATERIALIZED VIEW public_permits_by_cadastral_ids');
    expect(await cadastralRows()).toHaveLength(1);

    await migration.up(trx);
  });

  afterAll(async () => {
    await trx.rollback();
  });

  it('removes the test permit with all its data', async () => {
    const permitRow = await trx('permits').where({ id: testPermit }).first();
    expect(permitRow.deletedAt).not.toBeNull();
    expect(permitRow.deleteReason).toBe('OTHER');

    for (const [table, id] of rowsOf(testData)) {
      const deletedAt = await deletedAtOf(table, id);
      expect(deletedAt).not.toBeNull();
      // Kitas laikas nei leidimo — kitaip D2 atkūrimo migracija laikytų tai pakopa.
      expect(deletedAt.getTime()).toBeLessThan(permitRow.deletedAt.getTime());
    }
  });

  it('keeps the date of data deleted earlier', async () => {
    expect(await deletedAtOf('records', earlierDeletedRecord)).toEqual(earlierDeletedAt);
  });

  it('records the removal in the permit history', async () => {
    const histories = await trx('permitHistories').where({ permitId: testPermit });
    expect(histories).toEqual([
      expect.objectContaining({ type: 'DELETED', deleteReason: 'OTHER', createdBy: null }),
    ]);
    expect(histories[0].deleteOtherReason).toMatch(/Testinis leidimas/);
  });

  it('hides the test permit from the public cadastral search', async () => {
    expect(await cadastralRows()).toHaveLength(0);
  });

  it('leaves other permits alone', async () => {
    expect(await deletedAtOf('permits', sameNumberOtherDate)).toBeNull();
    expect(await deletedAtOf('permits', otherPermit)).toBeNull();
    for (const [table, id] of rowsOf(otherData)) {
      expect(await deletedAtOf(table, id)).toBeNull();
    }
  });

  it('does nothing when run again', async () => {
    await migration.up(trx);
    expect(await trx('permitHistories').where({ permitId: testPermit })).toHaveLength(1);
  });
});

describe('migration: remove the test permit already deleted in the admin', () => {
  const adminDeletedAt = new Date('2026-11-20T08:00:00Z');
  let testPermit: number;
  let testData: Awaited<ReturnType<typeof permitData>>;

  beforeAll(async () => {
    trx = await knex.transaction();
    await trx.raw('TRUNCATE records, animals, species, permit_species, permit_histories, permits');

    testPermit = await permit(TEST_NUMBER, TEST_ISSUE_DATE, adminDeletedAt);
    testData = await permitData(testPermit);

    await migration.up(trx);
  });

  afterAll(async () => {
    await trx.rollback();
    await knex.destroy();
  });

  it('removes its data and keeps the permit deletion as it was', async () => {
    for (const [table, id] of rowsOf(testData)) {
      expect(await deletedAtOf(table, id)).not.toBeNull();
    }
    expect(await deletedAtOf('permits', testPermit)).toEqual(adminDeletedAt);
    expect(await trx('permitHistories').where({ permitId: testPermit })).toHaveLength(0);
  });
});
