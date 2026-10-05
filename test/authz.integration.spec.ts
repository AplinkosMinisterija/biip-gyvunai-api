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

    const record: { id: number } = await broker.call(
      'records.newRecord',
      { animal: animalId, type: 'VACCINATION', date: '2026-02-02' },
      { meta: userMeta({ userId: OWNER }) },
    );
    recordId = record.id;
  });

  afterAll(async () => {
    await broker.stop();
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

describe('reference fields are frozen for non-admin updates (integration)', () => {
  let broker: ServiceBroker;
  let ownSpeciesId: number;
  let otherSpeciesId: number;
  let animalId: number;
  let recordId: number;

  beforeAll(async () => {
    await resetDomainTables();
    broker = await createTestBroker();
    const permitId = await createPermitFixture({ permitNumber: 'FROZEN-1', users: [OWNER] });
    const meta = userMeta({ userId: OWNER });

    const own: { id: number } = await broker.call(
      'species.newSpecies',
      { permit: permitId, speciesClassifier: 1, possessionType: 'WITH_PERMIT', type: 'GROUP' },
      { meta },
    );
    const other: { id: number } = await broker.call(
      'species.newSpecies',
      { permit: permitId, speciesClassifier: 2, possessionType: 'WITH_PERMIT', type: 'GROUP' },
      { meta },
    );
    ownSpeciesId = own.id;
    otherSpeciesId = other.id;

    const record: { id: number } = await broker.call(
      'records.newRecord',
      { species: ownSpeciesId, type: 'ACQUIREMENT', date: '2026-03-01', numberOfAnimals: 5 },
      { meta },
    );
    recordId = record.id;

    const individual: { id: number } = await broker.call(
      'species.newSpecies',
      { permit: permitId, speciesClassifier: 3, possessionType: 'WITH_PERMIT', type: 'INDIVIDUAL' },
      { meta },
    );
    const animal: { id: number } = await broker.call(
      'animals.newAnimal',
      { species: individual.id, gender: 'MALE', birthDate: '2025-05-05' },
      { meta },
    );
    animalId = animal.id;
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('owner cannot move a record to another species or change its stock fields', async () => {
    const updated: { species: number; type: string; numberOfAnimals: number } = await broker.call(
      'records.update',
      {
        id: recordId,
        species: otherSpeciesId,
        type: 'DEATH',
        numberOfAnimals: 1000,
        note: 'edited',
      },
      { meta: userMeta({ userId: OWNER }) },
    );

    expect(updated.species).toBe(ownSpeciesId);
    expect(updated.type).toBe('ACQUIREMENT');
    expect(updated.numberOfAnimals).toBe(5);
    expect((await knex('species').where({ id: otherSpeciesId }).first('amount')).amount).toBeNull();
  });

  it('owner cannot change species amount, permit or accounting type', async () => {
    const updated: { amount: number; type: string } = await broker.call(
      'species.update',
      { id: ownSpeciesId, amount: 1000000, type: 'INDIVIDUAL', permit: 9999 },
      { meta: userMeta({ userId: OWNER }) },
    );

    expect(updated.amount).toBe(5);
    expect(updated.type).toBe('GROUP');
  });

  it('owner cannot move an animal to another species', async () => {
    const updated: { species: number } = await broker.call(
      'animals.update',
      { id: animalId, species: otherSpeciesId },
      { meta: userMeta({ userId: OWNER }) },
    );

    expect(updated.species).not.toBe(otherSpeciesId);
  });

  it('admin reassigning a record recalculates both species', async () => {
    await broker.call(
      'records.update',
      { id: recordId, species: otherSpeciesId },
      { meta: adminMeta() },
    );

    expect((await knex('species').where({ id: ownSpeciesId }).first('amount')).amount).toBe(0);
    expect((await knex('species').where({ id: otherSpeciesId }).first('amount')).amount).toBe(5);
  });
});

// Bendras knex pool'as uždaromas vieną kartą, po abiejų describe blokų.
afterAll(async () => {
  await knex.destroy();
});
