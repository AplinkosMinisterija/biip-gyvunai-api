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
const ISSUE_DATE = '2026-01-01';
const ISSUER = 1;
const VALID_MUNICIPALITY = { id: 13, name: 'Vilniaus m. sav.' };

const insertId = (row: any) => Number(typeof row === 'object' ? row.id : row);

const createAviaryPermit = async (fields: Record<string, unknown> = {}) => {
  const [row] = await knex('permits')
    .insert({
      permitNumber: `AV-${Math.random().toString(36).slice(2, 8)}`,
      issueDate: new Date(ISSUE_DATE),
      issuerId: ISSUER,
      type: 'AVIARY',
      users: JSON.stringify([HOLDER]),
      createdAt: new Date(),
      ...fields,
    })
    .returning('id');
  return insertId(row);
};

describe('permit, species and classifier validation (integration)', () => {
  let broker: ServiceBroker;
  let familyId: number;
  let otherFamilyId: number;
  let speciesA: number;
  let speciesB: number;
  let speciesOtherFamily: number;
  const classifierIds: number[] = [];

  beforeAll(async () => {
    await resetDomainTables();
    broker = await createTestBroker();

    const families = await knex('familyClassifiers')
      .insert([
        { name: 'Testiniai elniniai', nameLatin: 'Cervidae test' },
        { name: 'Testiniai kiaulių', nameLatin: 'Suidae test' },
      ])
      .returning('id');
    [familyId, otherFamilyId] = families.map(insertId);

    const species = await knex('speciesClassifiers')
      .insert([
        { name: 'Testinis danielius', nameLatin: 'Dama testa', familyClassifierId: familyId },
        { name: 'Testinis elnias', nameLatin: 'Cervus testus', familyClassifierId: familyId },
        { name: 'Testinis šernas', nameLatin: 'Sus testus', familyClassifierId: otherFamilyId },
      ])
      .returning('id');
    [speciesA, speciesB, speciesOtherFamily] = species.map(insertId);
    classifierIds.push(speciesA, speciesB, speciesOtherFamily);
  });

  afterAll(async () => {
    await knex('speciesClassifiers').whereIn('id', classifierIds).delete();
    await knex('familyClassifiers').whereIn('id', [familyId, otherFamilyId]).delete();
    await broker.stop();
    await knex.destroy();
  });

  describe('permits', () => {
    const permitParams = (permitNumber: string, extra: Record<string, unknown> = {}) => ({
      permitNumber,
      issueDate: ISSUE_DATE,
      issuer: ISSUER,
      type: 'AVIARY',
      ...extra,
    });

    it('rejects creating a permit with an existing number, issuer and date', async () => {
      await broker.call('permits.create', permitParams('DUP-1'), { meta: adminMeta() });

      await expect(
        broker.call('permits.create', permitParams('DUP-1'), { meta: adminMeta() }),
      ).rejects.toMatchObject({ code: 400, type: 'BAD_REQUEST' });
    });

    it('rejects changing a permit number to one that already exists', async () => {
      const other: { id: number } = await broker.call('permits.create', permitParams('DUP-2'), {
        meta: adminMeta(),
      });

      await expect(
        broker.call(
          'permits.update',
          { id: other.id, permitNumber: 'DUP-1' },
          { meta: adminMeta() },
        ),
      ).rejects.toMatchObject({ code: 400, type: 'BAD_REQUEST' });
    });

    it('keeps legacy duplicate permits editable when the number is not changed', async () => {
      const legacyId = await createPermitFixture({ permitNumber: 'LEGACY-1' });
      await createPermitFixture({ permitNumber: 'LEGACY-1' });

      const updated: { address: string } = await broker.call(
        'permits.update',
        { id: legacyId, permitNumber: 'LEGACY-1', address: 'Naujas adresas' },
        { meta: adminMeta() },
      );

      expect(updated.address).toBe('Naujas adresas');
    });

    it('rejects an unknown permit type with a validation error instead of a database error', async () => {
      await expect(
        broker.call('permits.create', permitParams('TYPE-1', { type: 'CIRCUS' }), {
          meta: adminMeta(),
        }),
      ).rejects.toMatchObject({ code: 422 });
    });

    it('rejects a municipality without id and name', async () => {
      await expect(
        broker.call('permits.create', permitParams('MUN-1', { municipality: { foo: 'bar' } }), {
          meta: adminMeta(),
        }),
      ).rejects.toMatchObject({ code: 422 });
    });

    it('stores a valid municipality unchanged', async () => {
      const permit: { id: number } = await broker.call(
        'permits.create',
        permitParams('MUN-2', { municipality: VALID_MUNICIPALITY }),
        { meta: adminMeta() },
      );
      const [row] = await knex('permits').where({ id: permit.id }).select('municipality');

      expect(row.municipality).toEqual(VALID_MUNICIPALITY);
    });
  });

  describe('species on a permit', () => {
    const meta = userMeta({ userId: HOLDER });
    const newSpecies = (permit: number, speciesClassifier: number) =>
      broker.call(
        'species.newSpecies',
        { permit, speciesClassifier, possessionType: 'WITH_PERMIT', type: 'GROUP' },
        { meta },
      );

    it('allows a species listed in the permit', async () => {
      const permit = await createAviaryPermit();
      await knex('permitSpecies').insert({
        permitId: permit,
        speciesClassifierId: speciesA,
        familyClassifierId: familyId,
      });

      await expect(newSpecies(permit, speciesA)).resolves.toMatchObject({ permit });
    });

    it('rejects a species that the permit does not list', async () => {
      const permit = await createAviaryPermit();
      await knex('permitSpecies').insert({
        permitId: permit,
        speciesClassifierId: speciesA,
        familyClassifierId: familyId,
      });

      await expect(newSpecies(permit, speciesB)).rejects.toMatchObject({
        code: 422,
        type: 'INCORRECT_SPECIES',
      });
    });

    it('allows any species of a family listed without a specific species', async () => {
      const permit = await createAviaryPermit();
      await knex('permitSpecies').insert({ permitId: permit, familyClassifierId: familyId });

      await expect(newSpecies(permit, speciesB)).resolves.toMatchObject({ permit });
      await expect(newSpecies(permit, speciesOtherFamily)).rejects.toMatchObject({
        type: 'INCORRECT_SPECIES',
      });
    });

    it('does not restrict permits that list no species', async () => {
      const permit = await createAviaryPermit();

      await expect(newSpecies(permit, speciesOtherFamily)).resolves.toMatchObject({ permit });
    });

    it('requires a fencing off date for an aviary in a forest', async () => {
      const permit = await createAviaryPermit({ forest: true, fencingOffDate: null });

      await expect(newSpecies(permit, speciesA)).rejects.toMatchObject({
        code: 422,
        type: 'NO_FENCING_OFF_DATE',
      });
    });

    it('does not restrict zoo permits', async () => {
      const permit = await createPermitFixture({ permitNumber: 'ZOO-1', users: [HOLDER] });
      await knex('permitSpecies').insert({
        permitId: permit,
        speciesClassifierId: speciesA,
        familyClassifierId: familyId,
      });

      await expect(newSpecies(permit, speciesB)).resolves.toMatchObject({ permit });
    });
  });

  describe('species classifiers', () => {
    const create = (name: string, nameLatin: string): Promise<{ id: number }> =>
      broker.call(
        'speciesClassifiers.create',
        { name, nameLatin, family: familyId },
        { meta: adminMeta() },
      );

    it('rejects a duplicate that differs only by case and spaces', async () => {
      const created: { id: number } = await create('Unikalus vilkas', 'Canis testus');
      classifierIds.push(Number(created.id));

      await expect(create(' unikalus  VILKAS', 'canis  Testus ')).rejects.toMatchObject({
        code: 422,
      });
    });

    it('rejects renaming a classifier to an existing name', async () => {
      const created: { id: number } = await create('Kitas vilkas', 'Canis alius');
      classifierIds.push(Number(created.id));

      await expect(
        broker.call(
          'speciesClassifiers.update',
          { id: created.id, name: 'Unikalus vilkas', nameLatin: 'Canis testus' },
          { meta: adminMeta() },
        ),
      ).rejects.toMatchObject({ code: 422 });
    });

    it('allows saving a classifier without changing its names', async () => {
      const created: { id: number } = await create('Trečias vilkas', 'Canis tertius');
      classifierIds.push(Number(created.id));

      await expect(
        broker.call(
          'speciesClassifiers.update',
          { id: created.id, name: 'Trečias vilkas', nameLatin: 'Canis tertius', type: 'PROTECTED' },
          { meta: adminMeta() },
        ),
      ).resolves.toMatchObject({ type: 'PROTECTED' });
    });
  });
});
