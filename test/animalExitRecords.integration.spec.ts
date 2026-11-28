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

const insertId = (row: any) => Number(typeof row === 'object' ? row.id : row);

const insert = async (table: string, row: Record<string, unknown>): Promise<number> => {
  const [created] = await knex(table)
    .insert({ createdAt: new Date(), ...row })
    .returning('id');
  return insertId(created);
};

type AnimalWithRecords = {
  id: number;
  transferRecord?: { id: number; type: string } | null;
  releaseRecord?: { id: number; type: string } | null;
  saleRecord?: { id: number } | null;
  deathRecord?: { id: number } | null;
};

// Individualiai laikomas gyvūnas iš leidimo gali išeiti ne tik pardavus ar nugaišus, bet ir
// perdavus ar paleidus į laisvę — kaip grupinės apskaitos rūšys ir globojami gyvūnai.
describe('transfer and release of an individually kept animal (integration)', () => {
  let broker: ServiceBroker;
  let speciesId: number;
  let transferredId: number;
  let releasedId: number;
  let keptId: number;

  const holder = () => userMeta({ userId: HOLDER });
  const today = () => new Date().toISOString();

  const newRecord = (params: Record<string, unknown>) =>
    broker.call('records.newRecord', { date: today(), ...params }, { meta: holder() }) as Promise<{
      id: number;
      type: string;
    }>;

  const animal = (id: number): Promise<AnimalWithRecords> =>
    broker.call('animals.get', { id }, { meta: holder() });

  const amount = async () =>
    Number((await knex('species').where({ id: speciesId }).first('amount')).amount);

  beforeAll(async () => {
    await resetDomainTables();
    broker = await createTestBroker();
    const [classifierId] = await activeClassifierIds(1);
    const permitId = await createPermitFixture({ permitNumber: 'EXIT-1', users: [HOLDER] });

    speciesId = await insert('species', {
      permitId,
      speciesClassifierId: classifierId,
      possessionType: 'WITH_PERMIT',
      type: 'INDIVIDUAL',
      amount: 3,
      userId: HOLDER,
    });
    [transferredId, releasedId, keptId] = await Promise.all(
      [1, 2, 3].map(() =>
        insert('animals', { speciesId, permitId, gender: 'MALE', userId: HOLDER }),
      ),
    );
  });

  afterAll(async () => {
    await broker.stop();
    await knex.destroy();
  });

  it('a transfer takes the animal out of the species count', async () => {
    const record = await newRecord({
      type: 'TRANSFER',
      animal: transferredId,
      transferRecipient: { type: 'INDIVIDUAL', address: 'Testo g. 1', phone: '', email: '' },
    });

    expect(record.type).toBe('TRANSFER');
    expect(await amount()).toBe(2);
  });

  it('a release takes the animal out of the species count', async () => {
    // Svetainė kartu su gyvūnu siunčia ir rūšį.
    await newRecord({ type: 'RELEASE', animal: releasedId, species: speciesId });

    expect(await amount()).toBe(1);
  });

  it('the animal shows which record took it out', async () => {
    expect(await animal(transferredId)).toMatchObject({
      transferRecord: { type: 'TRANSFER' },
    });
    expect(await animal(releasedId)).toMatchObject({ releaseRecord: { type: 'RELEASE' } });

    const kept = await animal(keptId);
    expect(kept.transferRecord ?? null).toBeNull();
    expect(kept.releaseRecord ?? null).toBeNull();
  });

  it.each(['TRANSFER', 'RELEASE', 'SALE', 'DEATH'] as const)(
    'an animal that has left cannot get a %s record',
    async (type) => {
      for (const id of [transferredId, releasedId]) {
        await expect(newRecord({ type, animal: id, species: speciesId })).rejects.toMatchObject({
          code: 422,
          type: 'ANIMAL_ALREADY_LEFT',
        });
      }
      expect(await amount()).toBe(1);
    },
  );

  it('an animal that has left still takes records that do not move it', async () => {
    await expect(
      newRecord({ type: 'OTHER', animal: releasedId, species: speciesId, note: 'Pastaba' }),
    ).resolves.toMatchObject({ type: 'OTHER' });
    expect(await amount()).toBe(1);
  });

  it('annulling the transfer brings the animal back', async () => {
    const { transferRecord } = await animal(transferredId);

    await broker.call(
      'records.annul',
      { id: transferRecord!.id, reason: 'Įvesta per klaidą' },
      { meta: holder() },
    );

    expect(await amount()).toBe(2);
    expect((await animal(transferredId)).transferRecord ?? null).toBeNull();
  });

  it('after the wrong record is annulled the animal can leave another way', async () => {
    await expect(
      newRecord({ type: 'RELEASE', animal: transferredId, species: speciesId }),
    ).resolves.toMatchObject({ type: 'RELEASE' });

    expect(await amount()).toBe(1);
    expect(await animal(transferredId)).toMatchObject({ releaseRecord: { type: 'RELEASE' } });
  });
});
