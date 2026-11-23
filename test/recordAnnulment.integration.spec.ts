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
const STRANGER = 6;
const meta = userMeta({ userId: OWNER });
const strangerMeta = userMeta({ userId: STRANGER });
const today = () => new Date().toISOString();

type RecordRow = { id: number; annulledAt?: string; annulReason?: string; annulledBy?: number };

describe('annulling journal records (integration)', () => {
  let broker: ServiceBroker;
  let permit: number;
  let groupClassifier: number;
  let individualClassifier: number;

  beforeAll(async () => {
    await resetDomainTables();
    broker = await createTestBroker();
    permit = await createPermitFixture({ permitNumber: 'ANNUL-1', users: [OWNER, STRANGER] });
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
    broker.call('records.newRecord', { date: today(), ...params }, { meta }) as Promise<RecordRow>;

  const annul = (id: number, reason = 'Klaidingas įrašas', callMeta = meta) =>
    broker.call('records.annul', { id, reason }, { meta: callMeta }) as Promise<RecordRow>;

  const amountOf = async (id: number) =>
    (await knex('species').where({ id }).first('amount')).amount;

  it('stops counting an annulled record but keeps it in the journal', async () => {
    const species = await newSpecies('GROUP');
    await newRecord({ species, type: 'ACQUIREMENT', numberOfAnimals: 10 });
    const death = await newRecord({ species, type: 'DEATH', numberOfAnimals: 3 });
    expect(await amountOf(species)).toBe(7);

    const annulled = await annul(death.id, '  Įvesta per klaidą  ');
    expect(annulled).toMatchObject({ annulReason: 'Įvesta per klaidą', annulledBy: OWNER });
    expect(annulled.annulledAt).toBeTruthy();
    expect(await amountOf(species)).toBe(10);

    const list = (await broker.call('records.list', { query: { species } }, { meta })) as {
      rows: RecordRow[];
    };
    expect(list.rows.map(({ id }) => id)).toContain(death.id);

    const viewed = (await broker.call('records.get', { id: death.id }, { meta })) as RecordRow;
    expect(viewed.annulledAt).toBeTruthy();

    expect(
      await broker.call('records.find', { query: { species, type: 'DEATH' } }, { meta }),
    ).toEqual([]);
  });

  it('writes the reason and the person to the record history', async () => {
    const species = await newSpecies('GROUP');
    const acquirement = await newRecord({ species, type: 'ACQUIREMENT', numberOfAnimals: 2 });
    await annul(acquirement.id, 'Ne ta rūšis');

    const history = (await broker.call('records.getHistory', { id: acquirement.id }, { meta })) as {
      rows: Array<{ type: string; reason: string; createdBy: { id: number } | number }>;
    };
    expect(history.rows).toEqual([
      expect.objectContaining({ type: 'ANNULLED', reason: 'Ne ta rūšis' }),
    ]);
    expect(
      await knex('recordHistories').where({ recordId: acquirement.id }).first('createdBy'),
    ).toEqual({ createdBy: OWNER });
  });

  it('does not annul an acquisition whose animals have already left', async () => {
    const species = await newSpecies('GROUP');
    const acquirement = await newRecord({ species, type: 'ACQUIREMENT', numberOfAnimals: 5 });
    await newRecord({ species, type: 'SALE', numberOfAnimals: 4 });

    await expect(annul(acquirement.id)).rejects.toMatchObject({
      code: 422,
      type: 'INVALID_NUMBER_OF_ANIMALS',
    });
    expect((await knex('records').where({ id: acquirement.id }).first()).annulledAt).toBeNull();
    expect(await amountOf(species)).toBe(1);
  });

  it('does not annul a record twice', async () => {
    const species = await newSpecies('GROUP');
    const acquirement = await newRecord({ species, type: 'ACQUIREMENT', numberOfAnimals: 1 });
    await annul(acquirement.id);

    await expect(annul(acquirement.id)).rejects.toMatchObject({
      code: 422,
      type: 'RECORD_ANNULLED',
    });
  });

  it('requires a reason', async () => {
    const species = await newSpecies('GROUP');
    const acquirement = await newRecord({ species, type: 'ACQUIREMENT', numberOfAnimals: 1 });

    await expect(annul(acquirement.id, '   ')).rejects.toMatchObject({
      code: 422,
      type: 'VALIDATION_ERROR',
    });
  });

  it("hides another holder's record and its history", async () => {
    const species = await newSpecies('GROUP');
    const acquirement = await newRecord({ species, type: 'ACQUIREMENT', numberOfAnimals: 1 });

    await expect(annul(acquirement.id, 'Svetimas', strangerMeta)).rejects.toMatchObject({
      code: 404,
    });
    await expect(
      broker.call('records.getHistory', { id: acquirement.id }, { meta: strangerMeta }),
    ).rejects.toMatchObject({ code: 404 });
  });

  it('lets an admin annul any record', async () => {
    const species = await newSpecies('GROUP');
    const acquirement = await newRecord({ species, type: 'ACQUIREMENT', numberOfAnimals: 1 });

    await expect(annul(acquirement.id, 'AAD patikra', adminMeta())).resolves.toMatchObject({
      annulReason: 'AAD patikra',
    });
    expect(await amountOf(species)).toBe(0);
  });

  it('returns an animal to the stock when its death is annulled', async () => {
    const species = await newSpecies('INDIVIDUAL');
    const animal = (await broker.call(
      'animals.newAnimal',
      { species, gender: 'MALE', birthDate: today() },
      { meta },
    )) as { id: number };
    const death = await newRecord({ animal: animal.id, species, type: 'DEATH' });
    expect(await amountOf(species)).toBe(0);
    expect(
      await broker.call('animals.get', { id: animal.id, populate: ['deathRecord'] }, { meta }),
    ).toHaveProperty('deathRecord.id', death.id);

    await annul(death.id);

    expect(await amountOf(species)).toBe(1);
    const card = (await broker.call(
      'animals.get',
      { id: animal.id, populate: ['deathRecord'] },
      { meta },
    )) as { deathRecord: unknown };
    // Nesant įrašo laukas negrąžinamas.
    expect(card.deathRecord ?? null).toBeNull();
  });

  it('shows the previous certificate number when the latest one is annulled', async () => {
    const species = await newSpecies('INDIVIDUAL');
    const animal = (await broker.call(
      'animals.newAnimal',
      { species, gender: 'MALE', birthDate: today() },
      { meta },
    )) as { id: number };
    const certificate = (certificateNo: string, date: string) =>
      newRecord({ animal: animal.id, species, type: 'CERTIFICATE_NO', certificateNo, date });
    await certificate('CITES-1', new Date(Date.now() - 86400000).toISOString());
    const latest = await certificate('CITES-2', today());
    expect((await knex('animals').where({ id: animal.id }).first()).certificate).toBe('CITES-2');

    await annul(latest.id);

    expect((await knex('animals').where({ id: animal.id }).first()).certificate).toBe('CITES-1');
  });

  it('lets an admin see annulled records also with the scope that shows deleted data', async () => {
    const species = await newSpecies('GROUP');
    const acquirement = await newRecord({ species, type: 'ACQUIREMENT', numberOfAnimals: 1 });
    await annul(acquirement.id);

    for (const scope of ['false', '-notDeleted', ['-notDeleted']]) {
      const list = (await broker.call(
        'records.list',
        { query: { species }, scope },
        { meta: adminMeta() },
      )) as { rows: RecordRow[] };
      expect(list.rows.map(({ id }) => id)).toEqual([acquirement.id]);
    }
    expect(await broker.call('records.count', { query: { species } }, { meta })).toBe(0);
  });

  it('lets a member of the same company annul a record of the company', async () => {
    const company = 77;
    const companyPermit = await createPermitFixture({ permitNumber: 'ANNUL-T', tenant: company });
    const memberMeta = userMeta({ userId: 21, profile: company });
    const species = (
      (await broker.call(
        'species.newSpecies',
        {
          permit: companyPermit,
          speciesClassifier: groupClassifier,
          possessionType: 'WITH_PERMIT',
          type: 'GROUP',
        },
        { meta: memberMeta },
      )) as { id: number }
    ).id;
    const acquirement = (await broker.call(
      'records.newRecord',
      { species, type: 'ACQUIREMENT', numberOfAnimals: 1, date: today() },
      { meta: memberMeta },
    )) as RecordRow;

    await expect(
      annul(acquirement.id, 'Kolegos klaida', userMeta({ userId: 22, profile: company })),
    ).resolves.toMatchObject({ annulReason: 'Kolegos klaida' });
  });

  it('lets a new birth be entered after the wrong one is annulled', async () => {
    const species = await newSpecies('INDIVIDUAL');
    const animal = (await broker.call(
      'animals.newAnimal',
      { species, gender: 'MALE', birthDate: today() },
      { meta },
    )) as { id: number };
    const [birth] = (await broker.call(
      'records.find',
      { query: { animal: animal.id, type: 'BIRTH' } },
      { meta },
    )) as RecordRow[];

    await expect(newRecord({ animal: animal.id, species, type: 'BIRTH' })).rejects.toMatchObject({
      type: 'INVALID_RECORD_TYPE',
    });
    await annul(birth.id);
    await expect(newRecord({ animal: animal.id, species, type: 'BIRTH' })).resolves.toBeTruthy();
    expect(await amountOf(species)).toBe(1);
  });

  it('cannot be deleted through the API', () => {
    const remove = broker.registry
      .getActionList({ onlyLocal: true })
      .find(({ name }) => name === 'records.remove');
    expect(remove?.action).toMatchObject({ visibility: 'public', rest: null });
  });
});
