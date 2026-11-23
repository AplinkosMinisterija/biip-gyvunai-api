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
const daysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString();

type RecordRow = { id: number; type: string; note?: string; numberOfAnimals?: number };

describe('correcting journal records (integration)', () => {
  let broker: ServiceBroker;
  let permit: number;
  let groupClassifier: number;
  let individualClassifier: number;
  let markingType: number;

  beforeAll(async () => {
    await resetDomainTables();
    broker = await createTestBroker();
    permit = await createPermitFixture({ permitNumber: 'EDIT-1', users: [OWNER, STRANGER] });
    [groupClassifier, individualClassifier] = await activeClassifierIds(2);
    [markingType] = (await knex('markingTypeClassifiers').whereNull('deletedAt').pluck('id')).map(
      Number,
    );
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
    broker.call(
      'records.newRecord',
      { date: daysAgo(0), ...params },
      { meta },
    ) as Promise<RecordRow>;

  const edit = (id: number, changes: Record<string, unknown>, callMeta = meta) =>
    broker.call(
      'records.edit',
      { id, reason: 'Patikslinta', ...changes },
      { meta: callMeta },
    ) as Promise<RecordRow>;

  const historyOf = (id: number) => knex('recordHistories').where({ recordId: id }).orderBy('id');

  const amountOf = async (id: number) =>
    (await knex('species').where({ id }).first('amount')).amount;

  it('saves the changed fields with the reason in the history', async () => {
    const species = await newSpecies('GROUP');
    const record = await newRecord({
      species,
      type: 'TREATMENT',
      numberOfAnimals: 1,
      note: 'Gydytas',
      date: '2026-11-20T00:00:00.000Z',
    });

    const edited = await edit(record.id, {
      note: 'Gydytas nuo parazitų',
      date: '2026-11-21T00:00:00.000Z',
      reason: '  Netiksli data  ',
    });

    expect(edited.note).toBe('Gydytas nuo parazitų');
    const [history] = await historyOf(record.id);
    expect(history).toMatchObject({ type: 'UPDATED', reason: 'Netiksli data', createdBy: OWNER });
    expect(history.changes).toEqual({
      note: { old: 'Gydytas', new: 'Gydytas nuo parazitų' },
      date: { old: '2026-11-20T00:00:00.000Z', new: '2026-11-21T00:00:00.000Z' },
    });

    const listed = (await broker.call('records.getHistory', { id: record.id }, { meta })) as {
      rows: unknown[];
    };
    expect(listed.rows).toHaveLength(1);
  });

  it('requires a reason', async () => {
    const species = await newSpecies('GROUP');
    const record = await newRecord({ species, type: 'OTHER', note: 'A' });

    await expect(edit(record.id, { note: 'B', reason: ' ' })).rejects.toMatchObject({
      code: 422,
      type: 'VALIDATION_ERROR',
    });
  });

  it('writes nothing when nothing changed', async () => {
    const species = await newSpecies('INDIVIDUAL');
    const animal = (await broker.call(
      'animals.newAnimal',
      { species, gender: 'MALE', birthDate: daysAgo(0) },
      { meta },
    )) as { id: number };
    const marking = await newRecord({
      animal: animal.id,
      species,
      type: 'MARKING',
      markingNumber: 'Z-1',
      markingType,
      markingDate: '2026-11-20T00:00:00.000Z',
    });

    // Ženklinimo būdas grąžinamas užpildytas, bet lyginamas pagal id.
    await edit(marking.id, {
      markingType,
      markingNumber: 'Z-1',
      markingDate: '2026-11-20T00:00:00.000Z',
    });
    expect(await historyOf(marking.id)).toEqual([]);

    await edit(marking.id, { markingType, markingNumber: 'Z-2' });
    expect((await historyOf(marking.id)).map(({ changes }) => changes)).toEqual([
      { markingNumber: { old: 'Z-1', new: 'Z-2' } },
    ]);
  });

  it('recalculates the stock and keeps it from going negative', async () => {
    const species = await newSpecies('GROUP');
    await newRecord({ species, type: 'ACQUIREMENT', numberOfAnimals: 10 });
    const death = await newRecord({ species, type: 'DEATH', numberOfAnimals: 2 });

    await edit(death.id, { numberOfAnimals: 5 });
    expect(await amountOf(species)).toBe(5);

    await expect(edit(death.id, { numberOfAnimals: 11 })).rejects.toMatchObject({
      code: 422,
      type: 'INVALID_NUMBER_OF_ANIMALS',
    });
    await expect(edit(death.id, { numberOfAnimals: 0 })).rejects.toMatchObject({
      type: 'INVALID_NUMBER_OF_ANIMALS',
    });
    expect(await amountOf(species)).toBe(5);
  });

  it('changes the amount only where it counts', async () => {
    const group = await newSpecies('GROUP');
    const treatment = await newRecord({ species: group, type: 'TREATMENT', numberOfAnimals: 1 });
    await edit(treatment.id, { numberOfAnimals: 4 });
    expect(await historyOf(treatment.id)).toEqual([]);

    const individual = await newSpecies('INDIVIDUAL');
    const animal = (await broker.call(
      'animals.newAnimal',
      { species: individual, gender: 'MALE', birthDate: daysAgo(0) },
      { meta },
    )) as { id: number };
    const death = await newRecord({ animal: animal.id, species: individual, type: 'DEATH' });
    await edit(death.id, { numberOfAnimals: 0, note: 'Rastas negyvas' });
    expect((await historyOf(death.id)).map(({ changes }) => changes)).toEqual([
      { note: { old: null, new: 'Rastas negyvas' } },
    ]);
    expect((await knex('records').where({ id: death.id }).first()).numberOfAnimals).toBeNull();
  });

  it('stores a cleared text as empty and rejects an invalid date', async () => {
    const species = await newSpecies('GROUP');
    const record = await newRecord({ species, type: 'OTHER', note: 'A' });

    await edit(record.id, { note: '' });
    expect((await knex('records').where({ id: record.id }).first()).note).toBeNull();

    await expect(edit(record.id, { date: 'ne data' })).rejects.toMatchObject({
      code: 422,
      type: 'INVALID_DATE',
    });
  });

  it('does not change the type, animal or species of a record', async () => {
    const species = await newSpecies('GROUP');
    const otherSpecies = await newSpecies('GROUP');
    const record = await newRecord({ species, type: 'OTHER', note: 'A' });

    await edit(record.id, { note: 'B', type: 'DEATH', species: otherSpecies, animal: 1 });

    expect(await knex('records').where({ id: record.id }).first()).toMatchObject({
      type: 'OTHER',
      speciesId: species,
      animalId: null,
      note: 'B',
    });
  });

  it('updates the card certificate when its date changes', async () => {
    const species = await newSpecies('INDIVIDUAL');
    const animal = (await broker.call(
      'animals.newAnimal',
      { species, gender: 'MALE', birthDate: daysAgo(0) },
      { meta },
    )) as { id: number };
    const first = await newRecord({
      animal: animal.id,
      species,
      type: 'CERTIFICATE_NO',
      certificateNo: 'C-1',
      date: daysAgo(2),
    });
    await newRecord({
      animal: animal.id,
      species,
      type: 'CERTIFICATE_NO',
      certificateNo: 'C-2',
      date: daysAgo(1),
    });
    expect((await knex('animals').where({ id: animal.id }).first()).certificate).toBe('C-2');

    await edit(first.id, { date: daysAgo(0) });

    expect((await knex('animals').where({ id: animal.id }).first()).certificate).toBe('C-1');
  });

  it('does not change an annulled record', async () => {
    const species = await newSpecies('GROUP');
    const record = await newRecord({ species, type: 'OTHER', note: 'A' });
    await broker.call('records.annul', { id: record.id, reason: 'Klaida' }, { meta });

    await expect(edit(record.id, { note: 'B' })).rejects.toMatchObject({
      code: 422,
      type: 'RECORD_ANNULLED',
    });
  });

  it("hides another holder's record and lets an admin correct it", async () => {
    const species = await newSpecies('GROUP');
    const record = await newRecord({ species, type: 'OTHER', note: 'A' });

    await expect(edit(record.id, { note: 'B' }, strangerMeta)).rejects.toMatchObject({
      code: 404,
    });
    await expect(edit(record.id, { note: 'C' }, adminMeta())).resolves.toMatchObject({
      note: 'C',
    });
  });

  it('can be changed through the API only with a reason', () => {
    const actions = broker.registry.getActionList({ onlyLocal: true });
    const find = (name: string) => actions.find((action) => action.name === name)?.action;
    expect(find('records.update')).toMatchObject({ visibility: 'public', rest: null });
    expect(find('records.edit')).toMatchObject({ rest: 'PATCH /:id' });
  });
});
