'use strict';

import { ServiceBroker } from 'moleculer';
import {
  activeClassifierIds,
  createPermitFixture,
  createTestBroker,
  knex,
  resetDomainTables,
  userMeta,
} from './helpers/testBroker';

const HOLDER = 5;
const OTHER_HOLDER = 6;

const insert = async (table: string, row: Record<string, unknown>): Promise<number> => {
  const [created] = await knex(table)
    .insert({ createdAt: new Date(), ...row })
    .returning('id');
  return Number(typeof created === 'object' ? created.id : created);
};

type SavedRecord = { id: number; type: string };

// Įrašas rašomas rūšiai, jos gyvūnui arba globojamam gyvūnui. Visi kartu nurodyti objektai turi
// būti tarpusavyje susiję ir priklausyti įrašą kuriančiam laikytojui.
describe('what a new record may point at (integration)', () => {
  let broker: ServiceBroker;
  let classifierId: number;
  let otherClassifierId: number;
  const own = { permit: 0, species: 0, groupSpecies: 0, animal: 0, fostered: 0 };
  const foreign = { permit: 0, species: 0, groupSpecies: 0, animal: 0, fostered: 0 };

  const today = () => new Date().toISOString();

  const newRecord = (params: Record<string, unknown>, userId = HOLDER) =>
    broker.call(
      'records.newRecord',
      { date: today(), ...params },
      { meta: userMeta({ userId }) },
    ) as Promise<SavedRecord>;

  const recordsOf = (where: Record<string, unknown>) =>
    knex('records').where(where).whereNull('deletedAt');

  const recordCount = async () => Number((await knex('records').count('id as n').first())?.n);

  const amountOf = async (speciesId: number) =>
    Number((await knex('species').where({ id: speciesId }).first('amount')).amount);

  const species = (permitId: number, userId: number, type: string, amount: number) =>
    insert('species', {
      permitId,
      speciesClassifierId: classifierId,
      possessionType: 'WITH_PERMIT',
      type,
      amount,
      userId,
    });

  beforeAll(async () => {
    await resetDomainTables();
    broker = await createTestBroker();
    [classifierId, otherClassifierId] = await activeClassifierIds(2);

    own.permit = await createPermitFixture({ permitNumber: 'TARGET-OWN', users: [HOLDER] });
    own.species = await species(own.permit, HOLDER, 'INDIVIDUAL', 1);
    own.groupSpecies = await species(own.permit, HOLDER, 'GROUP', 10);
    own.animal = await insert('animals', {
      speciesId: own.species,
      permitId: own.permit,
      speciesClassifierId: classifierId,
      gender: 'MALE',
      userId: HOLDER,
    });
    own.fostered = await insert('fosteredAnimals', {
      speciesClassifierId: classifierId,
      gender: 'MALE',
      userId: HOLDER,
    });

    foreign.permit = await createPermitFixture({
      permitNumber: 'TARGET-FOREIGN',
      users: [OTHER_HOLDER],
    });
    foreign.species = await species(foreign.permit, OTHER_HOLDER, 'INDIVIDUAL', 1);
    foreign.groupSpecies = await species(foreign.permit, OTHER_HOLDER, 'GROUP', 4);
    foreign.animal = await insert('animals', {
      speciesId: foreign.species,
      permitId: foreign.permit,
      speciesClassifierId: classifierId,
      gender: 'FEMALE',
      userId: OTHER_HOLDER,
    });
    foreign.fostered = await insert('fosteredAnimals', {
      speciesClassifierId: classifierId,
      gender: 'FEMALE',
      userId: OTHER_HOLDER,
    });
  });

  afterAll(async () => {
    await broker.stop();
    await knex.destroy();
  });

  it('accepts a record for an own animal sent with its species', async () => {
    const record = await newRecord({ type: 'OTHER', animal: own.animal, species: own.species });

    expect(await knex('records').where({ id: record.id }).first()).toMatchObject({
      animalId: own.animal,
      speciesId: own.species,
      permitId: own.permit,
      userId: HOLDER,
    });
  });

  it.each([
    ['an own species', () => ({ species: own.species })],
    ['an own group species', () => ({ species: own.groupSpecies, numberOfAnimals: 1 })],
    ['its own species', () => ({ species: foreign.species })],
    ['no species', () => ({})],
  ])('refuses an animal of another holder sent with %s', async (_name, rest) => {
    const before = await recordCount();

    await expect(
      newRecord({ type: 'DEATH', animal: foreign.animal, ...rest() }),
    ).rejects.toMatchObject({ code: 401, type: 'NO_RIGHTS' });

    expect(await recordCount()).toBe(before);
    expect(await amountOf(foreign.species)).toBe(1);
    expect(await amountOf(own.groupSpecies)).toBe(10);
  });

  it.each([
    ['an animal', () => ({ animal: foreign.animal })],
    ['a species', () => ({ species: foreign.species })],
    ['an own animal and species', () => ({ animal: own.animal, species: own.species })],
  ])('refuses %s sent together with a fostered animal', async (_name, target) => {
    const before = await recordCount();

    await expect(
      newRecord({ type: 'DEATH', fosteredAnimal: own.fostered, ...target() }),
    ).rejects.toMatchObject({ code: 422, type: 'INVALID_FOSTERED_ANIMAL' });

    expect(await recordCount()).toBe(before);
  });

  it.each([0, '0', -1, 1.5])('refuses %p as the id of an animal or a species', async (id) => {
    const before = await recordCount();

    await expect(
      newRecord({ type: 'OTHER', fosteredAnimal: own.fostered, species: id, animal: id }),
    ).rejects.toMatchObject({ code: 422, type: 'VALIDATION_ERROR' });

    expect(await recordCount()).toBe(before);
  });

  it('refuses an own animal sent with another own species', async () => {
    await expect(
      newRecord({
        type: 'RELEASE',
        animal: own.animal,
        species: own.groupSpecies,
        numberOfAnimals: 2,
      }),
    ).rejects.toMatchObject({ code: 422, type: 'INVALID_SPECIES' });

    expect(await recordsOf({ animalId: own.animal, type: 'RELEASE' })).toEqual([]);
    expect(await amountOf(own.groupSpecies)).toBe(10);
  });

  it('takes the species, permit and classifier from the animal, not from the request', async () => {
    const record = await newRecord({
      type: 'OTHER',
      animal: own.animal,
      permit: foreign.permit,
      speciesClassifier: otherClassifierId,
    });

    expect(await knex('records').where({ id: record.id }).first()).toMatchObject({
      speciesId: own.species,
      permitId: own.permit,
      speciesClassifierId: classifierId,
    });
  });

  it('keeps a record of a fostered animal out of any permit', async () => {
    const record = await newRecord({
      type: 'OTHER',
      fosteredAnimal: own.fostered,
      permit: foreign.permit,
    });

    expect(await knex('records').where({ id: record.id }).first()).toMatchObject({
      fosteredAnimalId: own.fostered,
      permitId: null,
    });
  });

  it('refuses a foreign fostered animal', async () => {
    await expect(
      newRecord({ type: 'OTHER', fosteredAnimal: foreign.fostered }),
    ).rejects.toMatchObject({ code: 401, type: 'NO_RIGHTS' });
  });

  it('tells a stranger nothing about the records an animal already has', async () => {
    await insert('records', {
      animalId: foreign.animal,
      type: 'BIRTH',
      date: new Date(),
      userId: OTHER_HOLDER,
    });

    await expect(newRecord({ type: 'BIRTH', animal: foreign.animal })).rejects.toMatchObject({
      code: 401,
      type: 'NO_RIGHTS',
    });
    await expect(
      newRecord({ type: 'BIRTH', animal: foreign.animal }, OTHER_HOLDER),
    ).rejects.toMatchObject({ code: 422, type: 'INVALID_RECORD_TYPE' });
  });

  it('tells a stranger nothing about how many animals a species has', async () => {
    const sale = (numberOfAnimals: number, userId?: number) =>
      newRecord({ type: 'SALE', species: foreign.groupSpecies, numberOfAnimals }, userId);

    await expect(sale(1)).rejects.toMatchObject({ code: 401, type: 'NO_RIGHTS' });
    await expect(sale(5)).rejects.toMatchObject({ code: 401, type: 'NO_RIGHTS' });
    await expect(sale(5, OTHER_HOLDER)).rejects.toMatchObject({
      code: 422,
      type: 'INVALID_NUMBER_OF_ANIMALS',
    });
    expect(await amountOf(foreign.groupSpecies)).toBe(4);
  });

  describe('an individually kept species', () => {
    it.each(['SALE', 'DEATH', 'TRANSFER', 'RELEASE', 'BIRTH', 'ACQUIREMENT'])(
      'refuses a %s record that names no animal',
      async (type) => {
        await expect(
          newRecord({ type, species: own.species, numberOfAnimals: 1 }),
        ).rejects.toMatchObject({ code: 422, type: 'INVALID_ANIMAL' });

        expect(await recordsOf({ speciesId: own.species, type })).toEqual([]);
      },
    );

    it('still takes a record that does not change the count', async () => {
      await expect(newRecord({ type: 'OTHER', species: own.species })).resolves.toMatchObject({
        type: 'OTHER',
      });
      expect(await amountOf(own.species)).toBe(1);
    });
  });
});
