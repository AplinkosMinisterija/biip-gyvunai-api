'use strict';

import { ServiceBroker } from 'moleculer';
import { RestrictionType } from '../types';
import {
  adminMeta,
  createPermitFixture,
  createTestBroker,
  knex,
  resetDomainTables,
} from './helpers/testBroker';

describe('permit history (integration)', () => {
  let broker: ServiceBroker;
  let permit: number;

  beforeAll(async () => {
    await resetDomainTables();
    broker = await createTestBroker();
    permit = await createPermitFixture({ permitNumber: 'HIST-1' });
    await knex('permitHistories').insert([
      { permitId: permit, type: 'CREATED', createdAt: new Date() },
      { permitId: permit, type: 'UPDATED', createdAt: new Date() },
    ]);
  });

  afterAll(async () => {
    await broker.stop();
    await knex.destroy();
  });

  it('is available to admins only', () => {
    const action = broker.registry
      .getActionList({ onlyLocal: true })
      .find(({ name }) => name === 'permits.getHistory')?.action;
    expect(action).toMatchObject({ auth: RestrictionType.ADMIN });
  });

  it('only lists the history whatever the request asks for', async () => {
    const history = (await broker.call(
      'permits.getHistory',
      { id: permit, type: 'removeAllEntities' },
      { meta: adminMeta() },
    )) as { rows: unknown[] };

    expect(history.rows).toHaveLength(2);
    expect(await knex('permitHistories').where({ permitId: permit })).toHaveLength(2);
  });
});
