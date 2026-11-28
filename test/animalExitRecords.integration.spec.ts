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
const STRANGER = 6;
const EXIT_TYPES = ['SALE', 'DEATH', 'TRANSFER', 'RELEASE'] as const;

const insert = async (table: string, row: Record<string, unknown>): Promise<number> => {
  const [created] = await knex(table)
    .insert({ createdAt: new Date(), ...row })
    .returning('id');
  return Number(typeof created === 'object' ? created.id : created);
};

type ExitRecord = { id: number; type: string } | null;
type AnimalWithRecords = {
  id: number;
  transferRecord?: ExitRecord;
  releaseRecord?: ExitRecord;
  saleRecord?: ExitRecord;
  deathRecord?: ExitRecord;
};

// Individualiai laikomas gyvūnas iš leidimo gali išeiti ne tik pardavus ar nugaišus, bet ir
// perdavus ar paleidus į laisvę — kaip grupinės apskaitos rūšys ir globojami gyvūnai. Išeina jis
// vieną kartą.
describe('transfer and release of an individually kept animal (integration)', () => {
  let broker: ServiceBroker;
  let classifierId: number;
  let permitId: number;

  const today = () => new Date().toISOString();

  // Svetainė kartu su gyvūnu siunčia ir rūšį.
  const newRecord = (params: Record<string, unknown>, userId = HOLDER) =>
    broker.call(
      'records.newRecord',
      { date: today(), ...params },
      { meta: userMeta({ userId }) },
    ) as Promise<{ id: number; type: string }>;

  const annul = (id: number) =>
    broker.call(
      'records.annul',
      { id, reason: 'Įvesta per klaidą' },
      { meta: userMeta({ userId: HOLDER }) },
    );

  const animal = (id: number): Promise<AnimalWithRecords> =>
    broker.call('animals.get', { id }, { meta: userMeta({ userId: HOLDER }) });

  const amountOf = async (speciesId: number) =>
    Number((await knex('species').where({ id: speciesId }).first('amount')).amount);

  // Kiekvienas testas dirba su sava rūšimi ir jos gyvūnais.
  const speciesWithAnimals = async (count: number) => {
    const species = await insert('species', {
      permitId,
      speciesClassifierId: classifierId,
      possessionType: 'WITH_PERMIT',
      type: 'INDIVIDUAL',
      amount: count,
      userId: HOLDER,
    });
    const animals: number[] = [];
    for (let i = 0; i < count; i += 1) {
      animals.push(
        await insert('animals', {
          speciesId: species,
          permitId,
          speciesClassifierId: classifierId,
          gender: 'MALE',
          userId: HOLDER,
        }),
      );
    }

    return { species, animals };
  };

  beforeAll(async () => {
    await resetDomainTables();
    broker = await createTestBroker();
    [classifierId] = await activeClassifierIds(1);
    permitId = await createPermitFixture({ permitNumber: 'EXIT-1', users: [HOLDER] });
  });

  afterAll(async () => {
    await broker.stop();
    await knex.destroy();
  });

  it.each([
    ['TRANSFER', 'transferRecord'],
    ['RELEASE', 'releaseRecord'],
  ] as const)('a %s takes the animal out and shows on it', async (type, field) => {
    const { species, animals } = await speciesWithAnimals(2);
    const [gone, kept] = animals;

    const record = await newRecord({ type, animal: gone, species });

    expect(record.type).toBe(type);
    expect(await amountOf(species)).toBe(1);
    expect(await animal(gone)).toMatchObject({ [field]: { id: record.id, type } });
    expect((await animal(kept))[field] ?? null).toBeNull();
  });

  it('a record sent without the species counts the same', async () => {
    const { species, animals } = await speciesWithAnimals(2);

    await newRecord({ type: 'RELEASE', animal: animals[0] });

    expect(await amountOf(species)).toBe(1);
  });

  describe.each(EXIT_TYPES)('an animal that left by a %s record', (left) => {
    it.each(EXIT_TYPES)('cannot get a %s record', async (type) => {
      const { species, animals } = await speciesWithAnimals(2);
      await newRecord({ type: left, animal: animals[0], species });

      await expect(newRecord({ type, animal: animals[0], species })).rejects.toMatchObject({
        code: 422,
        type: 'ANIMAL_ALREADY_LEFT',
      });
      expect(await knex('records').where({ animalId: animals[0] })).toHaveLength(1);
      expect(await amountOf(species)).toBe(1);
    });
  });

  it('an animal that has left still takes records that do not move it', async () => {
    const { species, animals } = await speciesWithAnimals(1);
    await newRecord({ type: 'TRANSFER', animal: animals[0], species });

    await expect(
      newRecord({ type: 'OTHER', animal: animals[0], species, note: 'Pastaba' }),
    ).resolves.toMatchObject({ type: 'OTHER' });
    expect(await amountOf(species)).toBe(0);
  });

  it('annulling the record brings the animal back and lets it leave another way', async () => {
    const { species, animals } = await speciesWithAnimals(1);
    const transfer = await newRecord({ type: 'TRANSFER', animal: animals[0], species });

    await annul(transfer.id);

    expect(await amountOf(species)).toBe(1);
    expect((await animal(animals[0])).transferRecord ?? null).toBeNull();

    const release = await newRecord({ type: 'RELEASE', animal: animals[0], species });

    expect(await amountOf(species)).toBe(0);
    expect(await animal(animals[0])).toMatchObject({ releaseRecord: { id: release.id } });
  });

  it('a stranger is not told whether an animal has left', async () => {
    const { species, animals } = await speciesWithAnimals(2);
    const [gone, kept] = animals;
    await newRecord({ type: 'TRANSFER', animal: gone, species });

    for (const id of [gone, kept]) {
      await expect(
        newRecord({ type: 'DEATH', animal: id, species }, STRANGER),
      ).rejects.toMatchObject({ code: 401, type: 'NO_RIGHTS' });
    }
    expect(await amountOf(species)).toBe(1);
  });
});
