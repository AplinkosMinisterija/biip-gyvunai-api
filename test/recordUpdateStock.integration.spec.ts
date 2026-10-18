'use strict';

import { ServiceBroker } from 'moleculer';
import {
  activeClassifierIds,
  adminMeta,
  createPermitFixture,
  createTestBroker,
  knex,
  resetDomainTables,
  userMeta,
} from './helpers/testBroker';

const OWNER = 5;
const meta = userMeta({ userId: OWNER });
const INVALID_NUMBER = { code: 422, type: 'INVALID_NUMBER_OF_ANIMALS' };

describe('editing a record cannot make the stock negative (integration)', () => {
  let broker: ServiceBroker;
  let permit: number;
  let classifier: number;

  beforeAll(async () => {
    await resetDomainTables();
    broker = await createTestBroker();
    permit = await createPermitFixture({ permitNumber: 'STOCK-EDIT-1', users: [OWNER] });
    [classifier] = await activeClassifierIds(1);
  });

  afterAll(async () => {
    await broker.stop();
    await knex.destroy();
  });

  const groupSpecies = async () =>
    (
      (await broker.call(
        'species.newSpecies',
        {
          permit,
          speciesClassifier: classifier,
          possessionType: 'WITH_PERMIT',
          type: 'GROUP',
        },
        { meta },
      )) as { id: number }
    ).id;

  const newRecord = (species: number, type: string, numberOfAnimals: number) =>
    broker.call(
      'records.newRecord',
      { species, type, numberOfAnimals, date: '2026-03-01' },
      { meta },
    ) as Promise<{ id: number }>;

  const editAsAdmin = (id: number, changes: Record<string, unknown>) =>
    broker.call('records.update', { id, ...changes }, { meta: adminMeta() });

  const amountOf = async (id: number) =>
    (await knex('species').where({ id }).first('amount')).amount;

  it('rejects raising a death count above the stock and allows a valid change', async () => {
    const species = await groupSpecies();
    await newRecord(species, 'ACQUIREMENT', 10);
    const death = await newRecord(species, 'DEATH', 2);

    await expect(editAsAdmin(death.id, { numberOfAnimals: 100 })).rejects.toMatchObject(
      INVALID_NUMBER,
    );
    expect(await amountOf(species)).toBe(8);

    await editAsAdmin(death.id, { numberOfAnimals: 10 });
    expect(await amountOf(species)).toBe(0);
  });

  it('rejects lowering an acquisition below what has already left', async () => {
    const species = await groupSpecies();
    const acquisition = await newRecord(species, 'ACQUIREMENT', 10);
    await newRecord(species, 'SALE', 6);

    await expect(editAsAdmin(acquisition.id, { numberOfAnimals: 5 })).rejects.toMatchObject(
      INVALID_NUMBER,
    );
    await expect(editAsAdmin(acquisition.id, { numberOfAnimals: 0 })).rejects.toMatchObject(
      INVALID_NUMBER,
    );
    expect(await amountOf(species)).toBe(4);
  });

  it('rejects moving a record to a species whose stock would go negative', async () => {
    const source = await groupSpecies();
    const target = await groupSpecies();
    await newRecord(source, 'ACQUIREMENT', 5);
    const death = await newRecord(source, 'DEATH', 3);
    await newRecord(target, 'ACQUIREMENT', 1);

    await expect(editAsAdmin(death.id, { species: target })).rejects.toMatchObject(INVALID_NUMBER);
    expect([await amountOf(source), await amountOf(target)]).toEqual([2, 1]);
  });

  it('keeps an existing record editable by its other fields', async () => {
    const species = await groupSpecies();
    await newRecord(species, 'ACQUIREMENT', 3);
    const death = await newRecord(species, 'DEATH', 3);

    await expect(editAsAdmin(death.id, { note: 'Pataisyta pastaba' })).resolves.toMatchObject({
      note: 'Pataisyta pastaba',
    });
  });

  it('treats an explicit null as a change', async () => {
    const species = await groupSpecies();
    const acquisition = await newRecord(species, 'ACQUIREMENT', 10);
    await newRecord(species, 'SALE', 6);

    await expect(editAsAdmin(acquisition.id, { numberOfAnimals: null })).rejects.toMatchObject(
      INVALID_NUMBER,
    );
    await expect(editAsAdmin(acquisition.id, { species: null })).rejects.toMatchObject(
      INVALID_NUMBER,
    );
    expect(await amountOf(species)).toBe(4);
  });

  it('checks a change of record type', async () => {
    const species = await groupSpecies();
    await newRecord(species, 'ACQUIREMENT', 3);
    const vaccination = await newRecord(species, 'VACCINATION', 5);
    const death = await newRecord(species, 'DEATH', 1);

    await expect(editAsAdmin(vaccination.id, { type: 'DEATH' })).rejects.toMatchObject(
      INVALID_NUMBER,
    );
    await editAsAdmin(death.id, { type: 'VACCINATION' });
    expect(await amountOf(species)).toBe(3);
  });

  it('ignores stock fields sent by the owner, as before', async () => {
    const species = await groupSpecies();
    await newRecord(species, 'ACQUIREMENT', 10);
    const death = await newRecord(species, 'DEATH', 2);

    await broker.call('records.update', { id: death.id, numberOfAnimals: 100 }, { meta });
    expect(await amountOf(species)).toBe(8);
  });

  it('rejects removing an acquisition when its animals have already left', async () => {
    const species = await groupSpecies();
    const acquisition = await newRecord(species, 'ACQUIREMENT', 10);
    const sale = await newRecord(species, 'SALE', 6);

    await expect(
      broker.call('records.remove', { id: acquisition.id }, { meta }),
    ).rejects.toMatchObject(INVALID_NUMBER);
    await broker.call('records.remove', { id: sale.id }, { meta });
    expect(await amountOf(species)).toBe(10);
  });

  it('lets already negative legacy stock be fixed but not made worse', async () => {
    const species = await groupSpecies();
    const acquisition = await newRecord(species, 'ACQUIREMENT', 2);
    const death = await newRecord(species, 'DEATH', 2);
    // Senų duomenų pavyzdys: likutis jau neigiamas.
    await knex('species').where({ id: species }).update({ amount: -3 });

    await expect(editAsAdmin(death.id, { numberOfAnimals: 1 })).resolves.toBeTruthy();
    await expect(
      broker.call('records.remove', { id: acquisition.id }, { meta }),
    ).rejects.toMatchObject(INVALID_NUMBER);
  });
});
