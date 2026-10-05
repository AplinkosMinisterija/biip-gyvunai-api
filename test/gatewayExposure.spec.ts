'use strict';

import { ServiceBroker } from 'moleculer';
import { createTestBroker, knex } from './helpers/testBroker';

// API gateway naudoja `mappingPolicy: 'all'`: kiekvienas publikuotas veiksmas pasiekiamas
// HTTP keliu `/<servisas>/<veiksmas>` net ir be REST aliaso. Todėl veiksmai, kurie nėra
// skirti HTTP (vidiniai `create`, `findOne`, `resolve`, `createMany` ...), privalo būti
// paslėpti per `visibility: 'public'` — kitaip jie apeina nuosavybės ir rolių tikrinimus.
describe('gateway exposure invariant', () => {
  let broker: ServiceBroker;

  beforeAll(async () => {
    broker = await createTestBroker();
  });

  afterAll(async () => {
    await broker.stop();
    await knex.destroy();
  });

  it('every gateway-published action of a database service declares a REST alias', () => {
    const actions = broker.registry.getActionList({ onlyLocal: true });

    const exposedWithoutAlias = actions
      .filter(({ action }) => !action.visibility || action.visibility === 'published')
      .filter(({ action }) => action.rest === undefined || action.rest === null)
      .map(({ name }) => name)
      .filter((name) => !name.startsWith('$'))
      .sort();

    expect(exposedWithoutAlias).toEqual([]);
  });
});
