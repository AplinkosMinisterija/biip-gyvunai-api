'use strict';

import { ServiceBroker } from 'moleculer';
import MinioService from '../services/minio.service';
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

  // Paslėptas veiksmas su REST aliasu = dingęs maršrutas (moleculer-web aliasų negeneruoja
  // ne-published veiksmams). Taip buvo pamestas GET /users, kai dekoruotas list override'as
  // (be rest, nes jį paveldi iš mixin'o) gavo visibility 'public'.
  it('no action with a REST alias is hidden from the gateway', () => {
    const actions = broker.registry.getActionList({ onlyLocal: true });

    const hiddenWithAlias = actions
      .filter(({ action }) => action.visibility && action.visibility !== 'published')
      .filter(
        ({ action }) => action.rest !== undefined && action.rest !== null && action.rest !== false,
      )
      .map(({ name }) => name)
      .sort();

    expect(hiddenWithAlias).toEqual([]);
  });

  // minio startuoti testuose negalima (jungiasi prie MinIO), todėl tikrinama tik sujungta schema.
  it('minio service hides every mixin action without a REST alias', () => {
    const schemaBroker = new ServiceBroker({ logger: false });
    const service = schemaBroker.createService(MinioService);
    const actions = service.schema.actions as Record<
      string,
      { rest?: unknown; visibility?: string } | ((...args: unknown[]) => unknown)
    >;

    const exposedWithoutAlias = Object.entries(actions)
      .filter((entry): entry is [string, { rest?: unknown; visibility?: string }] => {
        return typeof entry[1] === 'object';
      })
      .filter(([, action]) => !action.visibility || action.visibility === 'published')
      .filter(([, action]) => action.rest === undefined || action.rest === null)
      .map(([name]) => name)
      .sort();

    expect(exposedWithoutAlias).toEqual([]);
  });
});
