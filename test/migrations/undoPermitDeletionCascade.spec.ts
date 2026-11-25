'use strict';

import { Knex } from 'knex';
import { knex } from '../helpers/testBroker';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const migration = require('../../database/migrations/20261022120000_undoPermitDeletionCascade.js');

// Migracija keičia visų panaikintų leidimų duomenis, todėl testas vyksta transakcijoje, kuri
// pabaigoje atšaukiama.
let trx: Knex.Transaction;

const insertId = (row: any) => Number(typeof row === 'object' ? row.id : row);

const insert = async (table: string, row: Record<string, unknown>): Promise<number> => {
  const [created] = await trx(table)
    .insert({ createdAt: new Date(), ...row })
    .returning('id');
  return insertId(created);
};

const deletedAtOf = async (table: string, id: number) =>
  (await trx(table).where({ id }).first('deletedAt')).deletedAt;

describe('migration: undo the permit deletion cascade', () => {
  const permitDeletedAt = new Date('2026-02-01T08:00:00Z');
  const earlierDeletedAt = new Date('2026-01-01T08:00:00Z');
  let cascaded: [string, number][];
  let earlierDeletedRecord: number;
  let activePermitRecord: number;
  let unlinkedRecord: number;
  let speciesId: number;

  const permit = (permitNumber: string, deletedAt: Date | null) =>
    insert('permits', {
      permitNumber,
      issueDate: new Date('2026-01-01'),
      issuerId: 1,
      type: 'AVIARY',
      deletedAt,
    });

  beforeAll(async () => {
    trx = await knex.transaction();
    await trx.raw('TRUNCATE records, animals, species, permit_species, permit_histories, permits');

    const deletedPermit = await permit('UNDO-DEL-1', permitDeletedAt);
    const withPermitDate = { deletedAt: permitDeletedAt, deletedBy: 1 };
    const species = await insert('species', {
      permitId: deletedPermit,
      speciesClassifierId: 1,
      possessionType: 'WITH_PERMIT',
      type: 'INDIVIDUAL',
      amount: 0,
      ...withPermitDate,
    });
    speciesId = species;
    const animal = await insert('animals', {
      speciesId: species,
      gender: 'MALE',
      ...withPermitDate,
    });
    const permitOnlyAnimal = await insert('animals', {
      permitId: deletedPermit,
      gender: 'FEMALE',
      ...withPermitDate,
    });
    cascaded = [
      ['species', species],
      ['animals', animal],
      ['animals', permitOnlyAnimal],
      [
        'records',
        await insert('records', {
          animalId: permitOnlyAnimal,
          type: 'BIRTH',
          date: new Date(),
          ...withPermitDate,
        }),
      ],
      [
        'records',
        await insert('records', {
          speciesId: species,
          type: 'ACQUIREMENT',
          date: new Date(),
          ...withPermitDate,
        }),
      ],
      [
        'records',
        await insert('records', {
          animalId: animal,
          type: 'BIRTH',
          date: new Date(),
          ...withPermitDate,
        }),
      ],
      [
        'permitSpecies',
        await insert('permitSpecies', {
          permitId: deletedPermit,
          speciesClassifierId: 1,
          ...withPermitDate,
        }),
      ],
    ];
    earlierDeletedRecord = await insert('records', {
      speciesId: species,
      type: 'OTHER',
      date: new Date(),
      deletedAt: earlierDeletedAt,
    });

    const activePermit = await permit('UNDO-ACT-1', null);
    activePermitRecord = await insert('records', {
      permitId: activePermit,
      type: 'OTHER',
      date: new Date(),
      deletedAt: permitDeletedAt,
    });

    unlinkedRecord = await insert('records', {
      type: 'OTHER',
      date: new Date(),
      deletedAt: permitDeletedAt,
    });

    await migration.up(trx);
  });

  afterAll(async () => {
    await trx.rollback();
    await knex.destroy();
  });

  it('restores the data deleted together with the permit', async () => {
    for (const [table, id] of cascaded) {
      expect(await deletedAtOf(table, id)).toBeNull();
    }
    expect(await trx('species').where({ id: cascaded[0][1] }).first('deletedBy')).toMatchObject({
      deletedBy: null,
    });
  });

  it('recalculates the amount of the restored species', async () => {
    expect(await trx('species').where({ id: speciesId }).first('amount')).toMatchObject({
      amount: 1,
    });
  });

  it('keeps data deleted separately before the permit', async () => {
    expect(await deletedAtOf('records', earlierDeletedRecord)).toEqual(earlierDeletedAt);
  });

  it('leaves deleted data of active permits and unlinked records alone', async () => {
    expect(await deletedAtOf('records', activePermitRecord)).toEqual(permitDeletedAt);
    expect(await deletedAtOf('records', unlinkedRecord)).toEqual(permitDeletedAt);
  });

  it('keeps the permit itself deleted', async () => {
    expect(
      await trx('permits').where({ permitNumber: 'UNDO-DEL-1' }).first('deletedAt'),
    ).toMatchObject({ deletedAt: permitDeletedAt });
  });
});
