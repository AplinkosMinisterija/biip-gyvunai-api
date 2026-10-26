'use strict';

import { Knex } from 'knex';
import { knex } from '../helpers/testBroker';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const migration = require('../../database/migrations/20261026130000_clearSystemPermitUpdates.js');

// Testas keičia leidimus, todėl vyksta transakcijoje, kuri pabaigoje atšaukiama.
let trx: Knex.Transaction;

const insertPermit = async (permitNumber: string, updatedAt: Date, updatedBy: number | null) => {
  const [row] = await trx('permits')
    .insert({
      permitNumber,
      issueDate: new Date('2025-01-01'),
      issuerId: 1,
      type: 'AVIARY',
      createdAt: new Date('2025-01-01'),
      updatedAt,
      updatedBy,
    })
    .returning('id');
  return Number(typeof row === 'object' ? row.id : row);
};

const updatedAtOf = async (id: number) =>
  (await trx('permits').where({ id }).first('updatedAt')).updatedAt;

describe('migration: clear system permit updates', () => {
  const adminEdit = new Date('2025-03-12T16:31:00Z');
  const userEdit = new Date('2025-10-03T08:54:30Z');
  const atWindowEnd = new Date('2025-10-03T08:56:00Z');
  const beforeWindow = new Date('2025-10-03T08:53:59Z');
  let systemUpdated: number;
  let editedByAdminWithoutUser: number;
  let editedByUser: number;
  let editedAtWindowEnd: number;
  let editedBeforeWindow: number;

  beforeAll(async () => {
    trx = await knex.transaction();
    await trx.raw('TRUNCATE records, animals, species, permit_species, permit_histories, permits');

    systemUpdated = await insertPermit('SYS-1', new Date('2025-10-03T08:55:30Z'), null);
    editedByAdminWithoutUser = await insertPermit('ADM-1', adminEdit, null);
    editedByUser = await insertPermit('USR-1', userEdit, 1);
    editedAtWindowEnd = await insertPermit('END-1', atWindowEnd, null);
    editedBeforeWindow = await insertPermit('BEFORE-1', beforeWindow, null);

    await migration.up(trx);
  });

  afterAll(async () => {
    await trx.rollback();
    await knex.destroy();
  });

  it('clears the date of the system batch update', async () => {
    expect(await updatedAtOf(systemUpdated)).toBeNull();
  });

  it('keeps the dates of changes made by people', async () => {
    expect(await updatedAtOf(editedByAdminWithoutUser)).toEqual(adminEdit);
    expect(await updatedAtOf(editedByUser)).toEqual(userEdit);
    expect(await updatedAtOf(editedAtWindowEnd)).toEqual(atWindowEnd);
    expect(await updatedAtOf(editedBeforeWindow)).toEqual(beforeWindow);
  });
});
