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

const OWNER = 5;
const meta = userMeta({ userId: OWNER });

describe('record vaccine name, marking certificate and current marking (integration)', () => {
  let broker: ServiceBroker;
  let groupSpecies: number;
  let individualSpecies: number;
  let markingTypeId: number;

  beforeAll(async () => {
    await resetDomainTables();
    broker = await createTestBroker();

    const permit = await createPermitFixture({ permitNumber: 'REC-FIELDS-1', users: [OWNER] });
    const [groupClassifier, individualClassifier] = await activeClassifierIds(2);
    const newSpecies = async (speciesClassifier: number, type: string) =>
      (
        (await broker.call(
          'species.newSpecies',
          { permit, speciesClassifier, possessionType: 'WITH_PERMIT', type },
          { meta },
        )) as { id: number }
      ).id;
    groupSpecies = await newSpecies(groupClassifier, 'GROUP');
    individualSpecies = await newSpecies(individualClassifier, 'INDIVIDUAL');

    const [markingType] = await knex('markingTypeClassifiers')
      .insert({ name: 'Testinis žiedas' })
      .returning('id');
    markingTypeId = Number(typeof markingType === 'object' ? markingType.id : markingType);
  });

  afterAll(async () => {
    await broker.stop();
    await knex('markingTypeClassifiers').where({ id: markingTypeId }).delete();
    await knex.destroy();
  });

  const newRecord = (params: Record<string, unknown>) =>
    broker.call('records.newRecord', params, { meta }) as Promise<{ id: number }>;

  const newAnimal = (params: Record<string, unknown> = {}) =>
    broker.call(
      'animals.newAnimal',
      { species: individualSpecies, gender: 'MALE', birthDate: '2025-01-01', ...params },
      { meta },
    ) as Promise<{ id: number }>;

  const markingRecordOf = async (animal: number) =>
    (
      (await broker.call('animals.get', { id: animal }, { meta })) as {
        markingRecord: { id: number; markingCertificateNo?: string } | null;
      }
    ).markingRecord;

  it('saves the vaccine name for individual and group records', async () => {
    const animal = await newAnimal();
    const individual = await newRecord({
      animal: animal.id,
      type: 'VACCINATION',
      date: '2026-03-01',
      vaccineName: 'Nobivac Rabies',
    });
    await newRecord({
      species: groupSpecies,
      type: 'ACQUIREMENT',
      date: '2026-03-01',
      numberOfAnimals: 4,
    });
    const group = await newRecord({
      species: groupSpecies,
      type: 'VACCINATION',
      date: '2026-03-02',
      numberOfAnimals: 4,
      vaccineName: 'Versican Plus',
    });

    expect(await knex('records').where({ id: individual.id }).first('vaccineName')).toEqual({
      vaccineName: 'Nobivac Rabies',
    });
    expect(await knex('records').where({ id: group.id }).first('vaccineName')).toEqual({
      vaccineName: 'Versican Plus',
    });
  });

  it('saves the marking certificate number, also when the animal is created', async () => {
    const animal = await newAnimal({
      markingType: markingTypeId,
      markingNumber: 'LT-0001',
      markingDate: '2025-02-01',
      markingCertificateNo: 'PAZ-1',
    });

    expect(await markingRecordOf(animal.id)).toMatchObject({ markingCertificateNo: 'PAZ-1' });
  });

  it('shows the latest marking by marking date, not by entry order', async () => {
    const animal = await newAnimal();
    const later = await newRecord({
      animal: animal.id,
      type: 'MARKING',
      date: '2026-05-01',
      markingDate: '2026-05-01',
      markingType: markingTypeId,
      markingNumber: 'NEW-CHIP',
      markingCertificateNo: 'PAZ-NEW',
    });
    await newRecord({
      animal: animal.id,
      type: 'MARKING',
      date: '2025-03-01',
      markingDate: '2025-03-01',
      markingType: markingTypeId,
      markingNumber: 'OLD-RING',
      markingCertificateNo: 'PAZ-OLD',
    });

    expect(await markingRecordOf(animal.id)).toMatchObject({
      id: later.id,
      markingCertificateNo: 'PAZ-NEW',
    });
  });

  it('falls back to the record date for old markings without a marking date', async () => {
    const animal = await newAnimal();
    const dated = await newRecord({
      animal: animal.id,
      type: 'MARKING',
      date: '2026-01-10',
      markingType: markingTypeId,
      markingNumber: 'NO-MARKING-DATE',
    });
    await newRecord({
      animal: animal.id,
      type: 'MARKING',
      date: '2025-01-10',
      markingDate: '2025-01-10',
      markingType: markingTypeId,
      markingNumber: 'OLDER',
    });

    expect(await markingRecordOf(animal.id)).toMatchObject({ id: dated.id });
  });
  it('shows the latest marking of a fostered animal', async () => {
    const [classifier] = await activeClassifierIds(1);
    const fostered = (await broker.call(
      'fosteredAnimals.newFosteredAnimal',
      {
        speciesClassifier: classifier,
        gender: 'FEMALE',
        address: 'Testo g. 1',
        municipality: { id: 13, name: 'Vilniaus m. sav.' },
        acquireType: 'FOUND',
        date: '2026-01-01',
        markingType: markingTypeId,
        markingNumber: 'FOSTER-OLD',
        markingCertificateNo: 'PAZ-FOSTER-OLD',
        files: [],
      },
      { meta },
    )) as { id: number };
    const later = await newRecord({
      fosteredAnimal: fostered.id,
      type: 'MARKING',
      date: '2026-04-01',
      markingDate: '2026-04-01',
      markingType: markingTypeId,
      markingNumber: 'FOSTER-NEW',
    });
    await newRecord({
      fosteredAnimal: fostered.id,
      type: 'MARKING',
      date: '2026-02-01',
      markingDate: '2026-02-01',
      markingType: markingTypeId,
      markingNumber: 'FOSTER-ENTERED-LAST',
    });

    const card = (await broker.call('fosteredAnimals.get', { id: fostered.id }, { meta })) as {
      markingRecord: { id: number } | null;
    };
    expect(card.markingRecord).toMatchObject({ id: later.id });
    expect(await knex('records').where({ id: later.id }).first('fosteredAnimalId')).toEqual({
      fosteredAnimalId: fostered.id,
    });
    expect(
      await knex('records')
        .where({ fosteredAnimalId: fostered.id, markingNumber: 'FOSTER-OLD' })
        .first('markingCertificateNo'),
    ).toEqual({ markingCertificateNo: 'PAZ-FOSTER-OLD' });
  });

  describe('current certificate number on the card', () => {
    const certificateOf = async (table: string, id: number) =>
      knex(table).where({ id }).first('certificate', 'updatedAt');

    it('follows the latest certificate record by date through create, edit and delete', async () => {
      const animal = await newAnimal({ certificate: 'CARD-ORIGINAL' });
      const certificate = (no: string, date: string) =>
        newRecord({ animal: animal.id, type: 'CERTIFICATE_NO', date, certificateNo: no });

      const latest = await certificate('CITES-2', '2026-02-01');
      expect(await certificateOf('animals', animal.id)).toEqual({
        certificate: 'CITES-2',
        updatedAt: null,
      });

      const earlier = await certificate('CITES-1', '2025-01-01');
      expect((await certificateOf('animals', animal.id)).certificate).toBe('CITES-2');

      await broker.call('records.update', { id: latest.id, certificateNo: 'CITES-2B' }, { meta });
      expect((await certificateOf('animals', animal.id)).certificate).toBe('CITES-2B');

      await broker.call('records.remove', { id: latest.id }, { meta });
      expect((await certificateOf('animals', animal.id)).certificate).toBe('CITES-1');

      await broker.call('records.remove', { id: earlier.id }, { meta });
      expect(await certificateOf('animals', animal.id)).toEqual({
        certificate: 'CITES-1',
        updatedAt: null,
      });
    });

    it('updates a fostered animal card', async () => {
      const [classifier] = await activeClassifierIds(1);
      const fostered = (await broker.call(
        'fosteredAnimals.newFosteredAnimal',
        {
          speciesClassifier: classifier,
          gender: 'MALE',
          address: 'Testo g. 2',
          municipality: { id: 13, name: 'Vilniaus m. sav.' },
          acquireType: 'FOUND',
          date: '2026-01-01',
          certificateNumber: 'FOSTER-CARD',
          files: [],
        },
        { meta },
      )) as { id: number };

      await newRecord({
        fosteredAnimal: fostered.id,
        type: 'CERTIFICATE_NO',
        date: '2026-03-01',
        certificateNo: 'FOSTER-CITES',
      });

      expect(
        await knex('fosteredAnimals').where({ id: fostered.id }).first('certificateNumber'),
      ).toEqual({ certificateNumber: 'FOSTER-CITES' });
      expect(
        (await knex('fosteredAnimals').where({ id: fostered.id }).first('updatedAt')).updatedAt,
      ).toBeNull();
    });

    it('leaves the group species card alone', async () => {
      await knex('species').where({ id: groupSpecies }).update({ certificateNumber: 'GROUP-CARD' });

      await newRecord({
        species: groupSpecies,
        type: 'CERTIFICATE_NO',
        date: '2026-03-01',
        certificateNo: 'GROUP-CITES',
      });

      expect(await knex('species').where({ id: groupSpecies }).first('certificateNumber')).toEqual({
        certificateNumber: 'GROUP-CARD',
      });
    });
  });
});
