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

const HOLDER = 5;
const STRANGER = 6;
const TENANT = 3;
const TENANT_MEMBER = 7;

const speciesParams = (permit?: number) => ({
  permit,
  speciesClassifier: 1,
  possessionType: 'WITH_PERMIT',
  type: 'GROUP',
});

describe('ownership on species/animal creation (integration)', () => {
  let broker: ServiceBroker;
  let holderPermitId: number;
  let tenantPermitId: number;

  beforeAll(async () => {
    await resetDomainTables();
    broker = await createTestBroker();
    holderPermitId = await createPermitFixture({ permitNumber: 'OWN-1', users: [HOLDER] });
    tenantPermitId = await createPermitFixture({ permitNumber: 'OWN-2', tenant: TENANT });
  });

  afterAll(async () => {
    await broker.stop();
    await knex.destroy();
  });

  it('rejects a species on a permit the user does not hold', async () => {
    await expect(
      broker.call('species.newSpecies', speciesParams(holderPermitId), {
        meta: userMeta({ userId: STRANGER }),
      }),
    ).rejects.toMatchObject({ code: 422, type: 'INVALID_PERMIT' });
  });

  it('rejects a permit species without a permit', async () => {
    await expect(
      broker.call('species.newSpecies', speciesParams(undefined), {
        meta: userMeta({ userId: HOLDER }),
      }),
    ).rejects.toMatchObject({ code: 422, type: 'INVALID_PERMIT' });
  });

  it('rejects a species on a permit that does not exist, even for admin', async () => {
    await expect(
      broker.call('species.newSpecies', speciesParams(9999), { meta: adminMeta() }),
    ).rejects.toMatchObject({ code: 422, type: 'INVALID_PERMIT' });
  });

  it('lets the permit holder create a species', async () => {
    const species: { permit: number; user: number } = await broker.call(
      'species.newSpecies',
      speciesParams(holderPermitId),
      { meta: userMeta({ userId: HOLDER }) },
    );

    expect(species.permit).toBe(holderPermitId);
    expect(species.user).toBe(HOLDER);
  });

  it('lets a tenant member create a species and an animal on a tenant permit without users', async () => {
    const meta = userMeta({ userId: TENANT_MEMBER, profile: TENANT });
    const species: { id: number; tenant: number } = await broker.call(
      'species.newSpecies',
      speciesParams(tenantPermitId),
      { meta },
    );
    expect(species.tenant).toBe(TENANT);

    const animal: { tenant: number } = await broker.call(
      'animals.newAnimal',
      { species: species.id, gender: 'MALE', birthDate: '2025-05-05' },
      { meta },
    );
    expect(animal.tenant).toBe(TENANT);
  });

  it('rejects an animal on a species whose permit the user does not hold', async () => {
    const [species] = await knex('species').where({ permitId: holderPermitId }).select('id');

    await expect(
      broker.call(
        'animals.newAnimal',
        { species: Number(species.id), gender: 'MALE', birthDate: '2025-05-05' },
        { meta: userMeta({ userId: STRANGER }) },
      ),
    ).rejects.toMatchObject({ code: 422, type: 'INVALID_PERMIT' });
  });
});
