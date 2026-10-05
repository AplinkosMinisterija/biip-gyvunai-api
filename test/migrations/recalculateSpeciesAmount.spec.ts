'use strict';

import { knex, resetDomainTables } from '../helpers/testBroker';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const migration = require('../../database/migrations/20261005120000_recalculateSpeciesAmount.js');

const insertSpecies = async (row: Record<string, unknown>): Promise<number> => {
  const [created] = await knex('species')
    .insert({ possessionType: 'WITH_PERMIT', createdAt: new Date(), ...row })
    .returning('id');
  return Number(typeof created === 'object' ? created.id : created);
};

const insertRecord = (row: Record<string, unknown>) =>
  knex('records').insert({ date: new Date(), createdAt: new Date(), ...row });

const insertAnimal = async (row: Record<string, unknown>): Promise<number> => {
  const [created] = await knex('animals')
    .insert({ gender: 'MALE', createdAt: new Date(), ...row })
    .returning('id');
  return Number(typeof created === 'object' ? created.id : created);
};

const amountOf = async (id: number): Promise<number | null> =>
  (await knex('species').where({ id }).first('amount')).amount;

describe('migration: recalculate species amounts', () => {
  let groupId: number;
  let individualId: number;
  let untouchedId: number;
  let untypedId: number;
  let deletedId: number;
  let allRemovedId: number;
  let nullCountId: number;
  let neutralOnlyId: number;

  beforeAll(async () => {
    await resetDomainTables();

    groupId = await insertSpecies({ type: 'GROUP', amount: 999 });
    await insertRecord({ speciesId: groupId, type: 'ACQUIREMENT', numberOfAnimals: 10 });
    await insertRecord({ speciesId: groupId, type: 'DEATH', numberOfAnimals: 2 });
    await insertRecord({ speciesId: groupId, type: 'TRANSFER', numberOfAnimals: 3 });
    await insertRecord({ speciesId: groupId, type: 'VACCINATION', numberOfAnimals: 10 });
    await insertRecord({
      speciesId: groupId,
      type: 'TRANSFER',
      numberOfAnimals: 50,
      deletedAt: new Date(),
    });

    individualId = await insertSpecies({ type: 'INDIVIDUAL', amount: 0 });
    const dead = await insertAnimal({ speciesId: individualId });
    await insertAnimal({ speciesId: individualId });
    await insertAnimal({ speciesId: individualId, deletedAt: new Date() });
    await insertRecord({ animalId: dead, type: 'BIRTH', numberOfAnimals: 1 });
    await insertRecord({ animalId: dead, type: 'DEATH', numberOfAnimals: 1 });

    untouchedId = await insertSpecies({ type: 'GROUP', amount: 7 });

    untypedId = await insertSpecies({ type: null, amount: null });
    await insertRecord({ speciesId: untypedId, type: 'ACQUIREMENT', numberOfAnimals: 4 });

    deletedId = await insertSpecies({ type: 'GROUP', amount: 3, deletedAt: new Date() });
    await insertRecord({ speciesId: deletedId, type: 'ACQUIREMENT', numberOfAnimals: 40 });

    allRemovedId = await insertSpecies({ type: 'GROUP', amount: 3 });
    await insertRecord({
      speciesId: allRemovedId,
      type: 'ACQUIREMENT',
      numberOfAnimals: 3,
      deletedAt: new Date(),
    });

    nullCountId = await insertSpecies({ type: 'GROUP', amount: null });
    await insertRecord({ speciesId: nullCountId, type: 'ACQUIREMENT', numberOfAnimals: null });
    await insertRecord({ speciesId: nullCountId, type: 'ACQUIREMENT', numberOfAnimals: 2 });

    neutralOnlyId = await insertSpecies({ type: 'GROUP', amount: null });
    await insertRecord({ speciesId: neutralOnlyId, type: 'VACCINATION', numberOfAnimals: 5 });

    await migration.up(knex);
  });

  afterAll(async () => {
    await knex.destroy();
  });

  it('sums live records of a group species, including transfers', async () => {
    expect(await amountOf(groupId)).toBe(5);
  });

  it('counts live animals without an outgoing record for an individual species', async () => {
    expect(await amountOf(individualId)).toBe(1);
  });

  it('leaves a species without related rows untouched', async () => {
    expect(await amountOf(untouchedId)).toBe(7);
  });

  it('treats a species without a type as group accounting', async () => {
    expect(await amountOf(untypedId)).toBe(4);
  });

  it('skips deleted species', async () => {
    expect(await amountOf(deletedId)).toBe(3);
  });

  it('zeroes a species whose records were all removed', async () => {
    expect(await amountOf(allRemovedId)).toBe(0);
  });

  it('treats a missing count as zero', async () => {
    expect(await amountOf(nullCountId)).toBe(2);
  });

  it('gives a species with only neutral records an amount of zero, as the runtime does', async () => {
    expect(await amountOf(neutralOnlyId)).toBe(0);
  });
});
