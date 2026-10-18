'use strict';

import { Knex } from 'knex';
import { knex } from '../helpers/testBroker';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const migration = require('../../database/migrations/20261018130000_permitDeletionCascade.js');

// Migracija perkuria viešą rodinį ir keičia visų panaikintų leidimų duomenis, todėl testas
// vyksta transakcijoje, kuri pabaigoje atšaukiama.
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

describe('migration: cascade existing permit deletions and hide them publicly', () => {
  const permitDeletedAt = new Date('2026-02-01T08:00:00Z');
  const earlierDeletedAt = new Date('2026-01-01T08:00:00Z');
  let deletedPermit: number;
  let activePermit: number;
  let deletedPermitChildren: [string, number][];
  let earlierDeletedRecord: number;
  let activeSpecies: number;

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

    activePermit = await permit('MIG-ACT-1', null);
    activeSpecies = await insert('species', {
      permitId: activePermit,
      speciesClassifierId: 1,
      possessionType: 'WITH_PERMIT',
      type: 'GROUP',
    });

    await migration.up(trx);
  });

  afterAll(async () => {
    await trx.rollback();
    await knex.destroy();
  });

  it('marks the children of a deleted permit deleted with the permit date', async () => {
    for (const [table, id] of deletedPermitChildren) {
      expect(await deletedAtOf(table, id)).toEqual(permitDeletedAt);
    }
  });

  it('keeps an earlier deletion date', async () => {
    expect(await deletedAtOf('records', earlierDeletedRecord)).toEqual(earlierDeletedAt);
  });

  it('leaves the data of active permits alone', async () => {
    expect(await deletedAtOf('species', activeSpecies)).toBeNull();
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
