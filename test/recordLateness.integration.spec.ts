'use strict';

import { ServiceBroker } from 'moleculer';
import {
  activeClassifierIds,
  adminMeta,
  createPermitFixture,
  createTestBroker,
  knex,
  resetDomainTables,
  userMeta,
} from './helpers/testBroker';

const OWNER = 5;
const meta = userMeta({ userId: OWNER });
const daysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
const LATE = { code: 422, type: 'LATE_REASON_REQUIRED' };

type RecordRow = { id: number; type: string; isLate: boolean; lateReason: string | null };

describe('late journal records (integration)', () => {
  let broker: ServiceBroker;
  let permit: number;
  let groupClassifier: number;
  let individualClassifier: number;

  beforeAll(async () => {
    await resetDomainTables();
    broker = await createTestBroker();
    permit = await createPermitFixture({ permitNumber: 'LATE-1', users: [OWNER] });
    [groupClassifier, individualClassifier] = await activeClassifierIds(2);
  });

  afterAll(async () => {
    await broker.stop();
    await knex.destroy();
  });

  const newSpecies = async (type: 'GROUP' | 'INDIVIDUAL') =>
    (
      (await broker.call(
        'species.newSpecies',
        {
          permit,
          speciesClassifier: type === 'GROUP' ? groupClassifier : individualClassifier,
          possessionType: 'WITH_PERMIT',
          type,
        },
        { meta },
      )) as { id: number }
    ).id;

  const newRecord = (params: Record<string, unknown>) =>
    broker.call('records.newRecord', params, { meta }) as Promise<RecordRow>;

  const recordsOf = async (animal: number) =>
    (await knex('records').where({ animalId: animal }).orderBy('id')) as Array<
      RecordRow & { type: string }
    >;

  it('requires a reason for a record entered more than 7 days after the event', async () => {
    const species = await newSpecies('GROUP');

    await expect(
      newRecord({ species, type: 'ACQUIREMENT', numberOfAnimals: 1, date: daysAgo(8) }),
    ).rejects.toMatchObject(LATE);

    const late = await newRecord({
      species,
      type: 'ACQUIREMENT',
      numberOfAnimals: 1,
      date: daysAgo(8),
      lateReason: ' Dokumentai gauti vėliau ',
    });
    expect(late).toMatchObject({ isLate: true, lateReason: 'Dokumentai gauti vėliau' });
  });

  it('requires the event date except for an other record', async () => {
    const species = await newSpecies('GROUP');

    await expect(
      newRecord({ species, type: 'ACQUIREMENT', numberOfAnimals: 1 }),
    ).rejects.toMatchObject({ code: 422, type: 'INVALID_DATE' });
    await expect(
      newRecord({ species, type: 'ACQUIREMENT', numberOfAnimals: 1, date: 'vakar' }),
    ).rejects.toMatchObject({ code: 422, type: 'INVALID_DATE' });
    await expect(newRecord({ species, type: 'OTHER', note: 'Be datos' })).resolves.toMatchObject({
      isLate: false,
    });
  });

  it('keeps a timely record unmarked whatever the client sends', async () => {
    const species = await newSpecies('GROUP');

    const timely = await newRecord({
      species,
      type: 'ACQUIREMENT',
      numberOfAnimals: 1,
      date: daysAgo(7),
      lateReason: 'Nereikia',
      isLate: true,
    });
    expect(timely).toMatchObject({ isLate: false, lateReason: null });
  });

  it('uses the marking date of a marking record', async () => {
    const species = await newSpecies('INDIVIDUAL');
    const animal = (await broker.call(
      'animals.newAnimal',
      { species, gender: 'MALE', birthDate: daysAgo(0) },
      { meta },
    )) as { id: number };

    await expect(
      newRecord({
        animal: animal.id,
        species,
        type: 'MARKING',
        markingNumber: 'Z-1',
        markingDate: daysAgo(30),
      }),
    ).rejects.toMatchObject(LATE);
    await expect(
      newRecord({
        animal: animal.id,
        species,
        type: 'MARKING',
        markingNumber: 'Z-1',
        markingDate: daysAgo(1),
        date: daysAgo(30),
      }),
    ).resolves.toMatchObject({ isLate: false });
  });

  describe('registering an animal', () => {
    const newAnimal = (params: Record<string, unknown>) =>
      broker.call('animals.newAnimal', { gender: 'MALE', ...params }, { meta }) as Promise<{
        id: number;
      }>;

    const acquiredFrom = { type: 'INDIVIDUAL', nationalityType: 'LOCAL', name: 'Pardavėjas' };

    it('judges an acquired animal by the acquisition, not by its birth', async () => {
      const species = await newSpecies('INDIVIDUAL');
      const animal = await newAnimal({
        species,
        birthDate: daysAgo(900),
        acquiredFrom,
        acquireDate: daysAgo(2),
      });

      expect((await recordsOf(animal.id)).map(({ type, isLate }) => [type, isLate])).toEqual([
        ['BIRTH', false],
        ['ACQUIREMENT', false],
      ]);
    });

    it('requires a reason for a late acquisition and marks only it', async () => {
      const species = await newSpecies('INDIVIDUAL');
      await expect(
        newAnimal({ species, birthDate: daysAgo(900), acquiredFrom, acquireDate: daysAgo(30) }),
      ).rejects.toMatchObject(LATE);
      expect(await knex('animals').where({ speciesId: species })).toEqual([]);

      const animal = await newAnimal({
        species,
        birthDate: daysAgo(900),
        acquiredFrom,
        acquireDate: daysAgo(30),
        lateReason: 'Pirktas užsienyje',
      });
      expect(
        (await recordsOf(animal.id)).map(({ type, isLate, lateReason }) => [
          type,
          isLate,
          lateReason,
        ]),
      ).toEqual([
        ['BIRTH', false, null],
        ['ACQUIREMENT', true, 'Pirktas užsienyje'],
      ]);
    });

    it('judges an animal born at the holder by its birth', async () => {
      const species = await newSpecies('INDIVIDUAL');
      await expect(newAnimal({ species, birthDate: daysAgo(30) })).rejects.toMatchObject(LATE);

      const animal = await newAnimal({
        species,
        birthDate: daysAgo(30),
        lateReason: 'Jauniklis rastas vėliau',
      });
      expect((await recordsOf(animal.id)).map(({ type, isLate }) => [type, isLate])).toEqual([
        ['BIRTH', true],
      ]);
    });
  });

  it('requires a reason for a late fostered animal registration', async () => {
    const register = (params: Record<string, unknown>) =>
      broker.call(
        'fosteredAnimals.newFosteredAnimal',
        {
          speciesClassifier: individualClassifier,
          gender: 'MALE',
          address: 'Testo g. 1',
          municipality: { id: 13, name: 'Vilniaus m. sav.' },
          acquireType: 'FOUND',
          date: daysAgo(20),
          files: [],
          ...params,
        },
        { meta },
      ) as Promise<{ id: number }>;

    await expect(register({})).rejects.toMatchObject(LATE);
    const fostered = await register({ lateReason: 'Perduotas iš kitos tarnybos' });
    expect(
      await knex('records').where({ fosteredAnimalId: fostered.id }).first('isLate', 'lateReason'),
    ).toEqual({ isLate: true, lateReason: 'Perduotas iš kitos tarnybos' });
  });

  describe('correcting a record', () => {
    const edit = (id: number, changes: Record<string, unknown>, callMeta = meta) =>
      broker.call(
        'records.edit',
        { id, reason: 'Patikslinta', ...changes },
        { meta: callMeta },
      ) as Promise<RecordRow>;

    it('marks a record the holder corrects more than 7 days after the event', async () => {
      const species = await newSpecies('GROUP');
      const timely = await newRecord({ species, type: 'OTHER', note: 'A', date: daysAgo(1) });

      await expect(edit(timely.id, { note: 'B' })).resolves.toMatchObject({ isLate: false });
      await expect(edit(timely.id, { date: daysAgo(10) })).resolves.toMatchObject({
        isLate: true,
      });
      // Žyma lieka visam laikui.
      await expect(edit(timely.id, { date: daysAgo(1) })).resolves.toMatchObject({
        isLate: true,
      });
    });

    it('marks an old record even when its date is moved to a recent day', async () => {
      const species = await newSpecies('GROUP');
      const record = await newRecord({ species, type: 'OTHER', note: 'A', date: daysAgo(1) });
      await knex('records')
        .where({ id: record.id })
        .update({ date: daysAgo(40) });

      await expect(edit(record.id, { date: daysAgo(2) })).resolves.toMatchObject({
        isLate: true,
      });
    });

    it('does not mark a record corrected by AAD', async () => {
      const species = await newSpecies('GROUP');
      const old = await newRecord({
        species,
        type: 'OTHER',
        note: 'A',
        date: daysAgo(1),
      });
      await knex('records')
        .where({ id: old.id })
        .update({ date: daysAgo(40) });

      await expect(edit(old.id, { note: 'B' }, adminMeta())).resolves.toMatchObject({
        isLate: false,
      });
    });
  });

  it('lets AAD list only late records', async () => {
    const species = await newSpecies('GROUP');
    const late = await newRecord({
      species,
      type: 'OTHER',
      date: daysAgo(9),
      lateReason: 'Vėliau',
    });
    await newRecord({ species, type: 'OTHER', date: daysAgo(0) });

    const list = (await broker.call(
      'records.list',
      { query: { species, isLate: true } },
      { meta: adminMeta() },
    )) as { rows: RecordRow[] };
    expect(list.rows.map(({ id }) => id)).toEqual([late.id]);
  });
});
