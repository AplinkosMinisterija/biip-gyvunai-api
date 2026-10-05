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

const OWNER = 5;
const STRANGER = 6;

describe('ownership on update/remove (integration)', () => {
  let broker: ServiceBroker;
  let animalId: number;
  let speciesId: number;
  let recordId: number;

  beforeAll(async () => {
    await resetDomainTables();
    broker = await createTestBroker();

    const permitId = await createPermitFixture({ permitNumber: 'AUTHZ-1', users: [OWNER] });

    const species: { id: number } = await broker.call(
      'species.newSpecies',
      {
        permit: permitId,
        speciesClassifier: 1,
        possessionType: 'WITH_PERMIT',
        type: 'INDIVIDUAL',
      },
      { meta: userMeta({ userId: OWNER }) },
    );
    speciesId = species.id;

    const animal: { id: number } = await broker.call(
      'animals.newAnimal',
      { species: speciesId, gender: 'MALE', birthDate: '2025-05-05' },
      { meta: userMeta({ userId: OWNER }) },
    );
    animalId = animal.id;

    await broker.call(
      'records.newRecord',
      { animal: animalId, type: 'VACCINATION', date: '2026-02-02' },
      { meta: userMeta({ userId: OWNER }) },
    );
    // newRecord dar negrąžina sukurto įrašo (afterCreate hook'as negrąžina rezultato) — imama iš DB.
    const [record] = await knex('records').where({ animalId, type: 'VACCINATION' }).select('id');
    recordId = Number(record.id);
  });

  afterAll(async () => {
    await broker.stop();
    await knex.destroy();
  });

  it('owner can update own animal', async () => {
    const updated: { gender: string } = await broker.call(
      'animals.update',
      { id: animalId, gender: 'FEMALE' },
      { meta: userMeta({ userId: OWNER }) },
    );

    expect(updated.gender).toBe('FEMALE');
  });

  it('stranger gets 404 when updating a foreign animal', async () => {
    await expect(
      broker.call(
        'animals.update',
        { id: animalId, gender: 'MALE' },
        { meta: userMeta({ userId: STRANGER }) },
      ),
    ).rejects.toMatchObject({ code: 404 });
  });

  it('stranger gets 404 when removing a foreign record or species', async () => {
    await expect(
      broker.call('records.remove', { id: recordId }, { meta: userMeta({ userId: STRANGER }) }),
    ).rejects.toMatchObject({ code: 404 });
    await expect(
      broker.call('species.remove', { id: speciesId }, { meta: userMeta({ userId: STRANGER }) }),
    ).rejects.toMatchObject({ code: 404 });
  });

  it('owner cannot reassign tenant or user through update', async () => {
    const updated: { tenant: number | null; user: number } = await broker.call(
      'animals.update',
      { id: animalId, tenant: 999, user: 999 },
      { meta: userMeta({ userId: OWNER }) },
    );

    expect(updated.tenant).toBeNull();
    expect(updated.user).toBe(OWNER);
  });

  it('admin can update any animal', async () => {
    const updated: { gender: string } = await broker.call(
      'animals.update',
      { id: animalId, gender: 'MALE' },
      { meta: adminMeta() },
    );

    expect(updated.gender).toBe('MALE');
  });

  it('owner can remove own record', async () => {
    await broker.call('records.remove', { id: recordId }, { meta: userMeta({ userId: OWNER }) });

    await expect(
      broker.call('records.get', { id: recordId }, { meta: userMeta({ userId: OWNER }) }),
    ).rejects.toMatchObject({ code: 404 });
  });
});
