'use strict';

import { ServiceBroker } from 'moleculer';
import {
  activeClassifierIds,
  adminMeta,
  createPermitFixture,
  createTestBroker,
  knex,
  resetDomainTables,
} from './helpers/testBroker';

// AAD sprendimas (#85, 30 kl.): atnaujinimo data rodo tik žmogaus pakeitimus.
describe('updatedAt shows human changes only (integration)', () => {
  let broker: ServiceBroker;
  let permitId: number;
  let classifierId: number;

  const updatedOf = async (table: string, id: number) =>
    (await knex(table).where({ id }).first('updatedAt', 'updatedBy')) as {
      updatedAt: Date | null;
      updatedBy: number | null;
    };

  beforeAll(async () => {
    await resetDomainTables();
    broker = await createTestBroker();
    permitId = await createPermitFixture({ permitNumber: 'UPDATED-AT-1' });
    [classifierId] = await activeClassifierIds(1);
  });

  afterAll(async () => {
    await broker.stop();
    await knex.destroy();
  });

  it('recalculating the species amount does not touch its updatedAt', async () => {
    const species: { id: number } = await broker.call(
      'species.newSpecies',
      {
        permit: permitId,
        speciesClassifier: classifierId,
        possessionType: 'WITH_PERMIT',
        type: 'GROUP',
      },
      { meta: adminMeta() },
    );

    await broker.call(
      'records.newRecord',
      { species: species.id, type: 'ACQUIREMENT', date: '2026-01-10', numberOfAnimals: 4 },
      { meta: adminMeta() },
    );

    expect((await knex('species').where({ id: species.id }).first('amount')).amount).toBe(4);
    expect(await updatedOf('species', species.id)).toEqual({ updatedAt: null, updatedBy: null });
  });

  it('saving a permit with the same species does not touch its permit species rows', async () => {
    const family = (await knex('speciesClassifiers').where({ id: classifierId }).first())
      .familyClassifierId;
    const row = { family, species: classifierId, permit: permitId };

    const created: { id: number } = await broker.call('permits.species.createOrUpdate', row);
    const again: { id: number } = await broker.call('permits.species.createOrUpdate', {
      ...row,
      id: created.id,
    });

    expect(again.id).toBe(created.id);
    expect(await updatedOf('permitSpecies', created.id)).toEqual({
      updatedAt: null,
      updatedBy: null,
    });
  });
});
