'use strict';

import { ServiceBroker } from 'moleculer';
import {
  adminMeta,
  createPermitFixture,
  createTestBroker,
  knex,
  resetDomainTables,
  userMeta,
} from './helpers/testBroker';

const TENANT = 3;
const MEMBER = 5;

const amountOf = async (speciesId: number): Promise<number | null> => {
  const row = await knex('species').where({ id: speciesId }).first('amount');
  return row.amount;
};

describe('species amount recalculation (integration)', () => {
  let broker: ServiceBroker;
  let permitId: number;
  const member = () => userMeta({ userId: MEMBER, profile: TENANT });

  beforeAll(async () => {
    await resetDomainTables();
    broker = await createTestBroker();
    permitId = await createPermitFixture({ permitNumber: 'AMOUNT-1', tenant: TENANT });
  });

  afterAll(async () => {
    await broker.stop();
    await knex.destroy();
  });

  describe('group accounting species', () => {
    let speciesId: number;
    let transferId: number;

    beforeAll(async () => {
      const species: { id: number } = await broker.call(
        'species.newSpecies',
        { permit: permitId, speciesClassifier: 1, possessionType: 'WITH_PERMIT', type: 'GROUP' },
        { meta: member() },
      );
      speciesId = species.id;
    });

    it('newRecord returns the created record', async () => {
      const record: { id: number; type: string } = await broker.call(
        'records.newRecord',
        { species: speciesId, type: 'ACQUIREMENT', date: '2026-01-10', numberOfAnimals: 10 },
        { meta: adminMeta() },
      );

      expect(record.type).toBe('ACQUIREMENT');
      expect(record.id).toBeGreaterThan(0);
      expect(await amountOf(speciesId)).toBe(10);
    });

    it('sums records of all users, not only the current one', async () => {
      await broker.call(
        'records.newRecord',
        { species: speciesId, type: 'DEATH', date: '2026-01-11', numberOfAnimals: 2 },
        { meta: member() },
      );

      expect(await amountOf(speciesId)).toBe(8);
    });

    it('subtracts transfers and releases', async () => {
      const transfer: { id: number } = await broker.call(
        'records.newRecord',
        { species: speciesId, type: 'TRANSFER', date: '2026-01-12', numberOfAnimals: 3 },
        { meta: member() },
      );
      transferId = transfer.id;
      await broker.call(
        'records.newRecord',
        { species: speciesId, type: 'RELEASE', date: '2026-01-13', numberOfAnimals: 1 },
        { meta: member() },
      );

      expect(await amountOf(speciesId)).toBe(4);
    });

    it('recalculates when a record is removed', async () => {
      await broker.call('records.remove', { id: transferId }, { meta: member() });

      expect(await amountOf(speciesId)).toBe(7);
    });

    it('rejects an outgoing record larger than the current stock', async () => {
      await expect(
        broker.call(
          'records.newRecord',
          { species: speciesId, type: 'DEATH', date: '2026-01-14', numberOfAnimals: 100 },
          { meta: member() },
        ),
      ).rejects.toMatchObject({ code: 422, type: 'INVALID_NUMBER_OF_ANIMALS' });
    });

    it('rejects a stock-changing record without a count', async () => {
      await expect(
        broker.call(
          'records.newRecord',
          { species: speciesId, type: 'ACQUIREMENT', date: '2026-01-15' },
          { meta: member() },
        ),
      ).rejects.toMatchObject({ code: 422, type: 'INVALID_NUMBER_OF_ANIMALS' });
    });

    it('accepts a neutral record without a count and keeps the amount', async () => {
      await broker.call(
        'records.newRecord',
        { species: speciesId, type: 'VACCINATION', date: '2026-01-16' },
        { meta: member() },
      );

      expect(await amountOf(speciesId)).toBe(7);
    });
  });

  describe('individual accounting species', () => {
    let speciesId: number;
    let firstAnimalId: number;
    let secondAnimalId: number;

    beforeAll(async () => {
      const species: { id: number } = await broker.call(
        'species.newSpecies',
        {
          permit: permitId,
          speciesClassifier: 1,
          possessionType: 'WITH_PERMIT',
          type: 'INDIVIDUAL',
        },
        { meta: member() },
      );
      speciesId = species.id;
    });

    it('counts registered animals', async () => {
      const first: { id: number } = await broker.call(
        'animals.newAnimal',
        { species: speciesId, gender: 'MALE', birthDate: '2025-01-01' },
        { meta: member() },
      );
      const second: { id: number } = await broker.call(
        'animals.newAnimal',
        { species: speciesId, gender: 'FEMALE', birthDate: '2025-02-02' },
        { meta: member() },
      );
      firstAnimalId = first.id;
      secondAnimalId = second.id;

      expect(second.id).not.toBe(first.id);
      expect(await amountOf(speciesId)).toBe(2);
    });

    it('excludes an animal with a death record', async () => {
      await broker.call(
        'records.newRecord',
        { animal: firstAnimalId, type: 'DEATH', date: '2026-02-01', deathReason: 'FOUND_DEAD' },
        { meta: member() },
      );

      expect(await amountOf(speciesId)).toBe(1);
    });

    it('recalculates when an animal is removed', async () => {
      await broker.call('animals.remove', { id: secondAnimalId }, { meta: member() });

      expect(await amountOf(speciesId)).toBe(0);
    });
  });
});
