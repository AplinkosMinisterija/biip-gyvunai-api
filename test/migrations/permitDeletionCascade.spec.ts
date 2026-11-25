'use strict';

import { Knex } from 'knex';
import { knex } from '../helpers/testBroker';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const migration = require('../../database/migrations/20261018130000_permitDeletionCascade.js');

// Migracija perkuria viešą rodinį, todėl testas vyksta transakcijoje, kuri pabaigoje atšaukiama.
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

describe('migration: hide deleted permits from the public cadastral search', () => {
  const permitDeletedAt = new Date('2026-02-01T08:00:00Z');
  const earlierDeletedAt = new Date('2026-01-01T08:00:00Z');
  let deletedPermit: number;
  let deletedPermitChildren: [string, number][];
  let earlierDeletedRecord: number;

  const permit = (permitNumber: string, deletedAt: Date | null) =>
    insert('permits', {
      permitNumber,
      issueDate: new Date('2026-01-01'),
      issuerId: 1,
      type: 'AVIARY',
      cadastralIds: JSON.stringify([{ cadastral_number: `CAD-${permitNumber}` }]),
      deletedAt,
    });

  beforeAll(async () => {
    trx = await knex.transaction();
    await trx.raw('TRUNCATE records, animals, species, permit_species, permit_histories, permits');

    deletedPermit = await permit('MIG-DEL-1', permitDeletedAt);
    const species = await insert('species', {
      permitId: deletedPermit,
      speciesClassifierId: 1,
      possessionType: 'WITH_PERMIT',
      type: 'GROUP',
    });
    const animal = await insert('animals', { speciesId: species, gender: 'MALE' });
    deletedPermitChildren = [
      ['species', species],
      ['animals', animal],
      [
        'records',
        await insert('records', { speciesId: species, type: 'ACQUIREMENT', date: new Date() }),
      ],
      ['records', await insert('records', { animalId: animal, type: 'BIRTH', date: new Date() })],
      [
        'permitSpecies',
        await insert('permitSpecies', { permitId: deletedPermit, speciesClassifierId: 1 }),
      ],
    ];
    earlierDeletedRecord = await insert('records', {
      speciesId: species,
      type: 'OTHER',
      date: new Date(),
      deletedAt: earlierDeletedAt,
    });

    await permit('MIG-ACT-1', null);

    await migration.up(trx);
  });

  afterAll(async () => {
    await trx.rollback();
    await knex.destroy();
  });

  it('keeps the data of a deleted permit, its animals stay until transferred', async () => {
    for (const [table, id] of deletedPermitChildren) {
      expect(await deletedAtOf(table, id)).toBeNull();
    }
    expect(await deletedAtOf('records', earlierDeletedRecord)).toEqual(earlierDeletedAt);
  });

  it('shows only active permits in the public cadastral search', async () => {
    const rows = await trx('publicPermitsByCadastralIds').whereIn('cadastralNumber', [
      'CAD-MIG-DEL-1',
      'CAD-MIG-ACT-1',
    ]);

    expect(rows.map((row: { cadastralNumber: string }) => row.cadastralNumber)).toEqual([
      'CAD-MIG-ACT-1',
    ]);
  });
});
