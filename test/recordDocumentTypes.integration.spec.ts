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
const today = () => new Date().toISOString();
const TYPE_REQUIRED = { code: 422, type: 'DOCUMENT_TYPE_REQUIRED' };

type RecordFile = { name: string; url: string; size?: number; type?: number; typeName?: string };
type RecordRow = { id: number; file: RecordFile[] | null };

const file = (name: string, type?: number): RecordFile => ({
  name,
  size: 100,
  url: `https://minio.test/records/${name}`,
  ...(type ? { type } : {}),
});

describe('document types of record files (integration)', () => {
  let broker: ServiceBroker;
  let species: number;
  let contract: number;
  let other: number;
  let removedType: number;

  beforeAll(async () => {
    await resetDomainTables();
    broker = await createTestBroker();
    const permit = await createPermitFixture({ permitNumber: 'DOC-1', users: [OWNER] });
    const [classifier] = await activeClassifierIds(1);
    species = (
      (await broker.call(
        'species.newSpecies',
        { permit, speciesClassifier: classifier, possessionType: 'WITH_PERMIT', type: 'GROUP' },
        { meta },
      )) as { id: number }
    ).id;

    const types = await knex('documentTypeClassifiers').whereNull('deletedAt').orderBy('id');
    contract = Number(types.find(({ name }) => name.startsWith('Pirkimo'))!.id);
    other = Number(types.find(({ name }) => name === 'Kita')!.id);
    const [removed] = await knex('documentTypeClassifiers')
      .insert({ name: 'Panaikintas tipas', deletedAt: new Date() })
      .returning('id');
    removedType = Number(typeof removed === 'object' ? removed.id : removed);
  });

  afterAll(async () => {
    await knex('documentTypeClassifiers').where({ id: removedType }).delete();
    await broker.stop();
    await knex.destroy();
  });

  const newRecord = (files?: RecordFile[]) =>
    broker.call(
      'records.newRecord',
      { species, type: 'ACQUIREMENT', numberOfAnimals: 1, date: today(), file: files },
      { meta },
    ) as Promise<RecordRow>;

  const edit = (id: number, files: RecordFile[]) =>
    broker.call('records.edit', { id, reason: 'Pridėtas dokumentas', file: files }, { meta });

  it('starts with the document types from the legal acts and "Kita"', async () => {
    const names = (await broker.call('documentTypeClassifiers.find', {})) as Array<{
      name: string;
    }>;
    expect(names.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'Pirkimo–pardavimo sutartis / sąskaita faktūra',
        'CITES sertifikatas / leidimas',
        'AAD aktas / pažyma',
        'Perdavimo–priėmimo aktas',
        'Veterinarinė išvada',
        'Kita',
      ]),
    );
  });

  it('requires an existing document type for every new document', async () => {
    await expect(newRecord([file('a.pdf')])).rejects.toMatchObject(TYPE_REQUIRED);
    await expect(newRecord([file('a.pdf', 999999)])).rejects.toMatchObject(TYPE_REQUIRED);
    await expect(newRecord([file('a.pdf', removedType)])).rejects.toMatchObject(TYPE_REQUIRED);
  });

  it('stores the type name with the document', async () => {
    const record = await newRecord([file('sutartis.pdf', contract), file('kita.pdf', other)]);

    expect(record.file).toEqual([
      {
        ...file('sutartis.pdf', contract),
        typeName: 'Pirkimo–pardavimo sutartis / sąskaita faktūra',
      },
      { ...file('kita.pdf', other), typeName: 'Kita' },
    ]);
  });

  it('keeps old documents without a type and asks a type only for new ones', async () => {
    const record = await newRecord();
    await knex('records')
      .where({ id: record.id })
      .update({ file: JSON.stringify([file('senas.pdf')]) });

    await expect(edit(record.id, [file('senas.pdf'), file('naujas.pdf')])).rejects.toMatchObject(
      TYPE_REQUIRED,
    );

    const edited = (await edit(record.id, [
      file('senas.pdf'),
      file('naujas.pdf', other),
    ])) as RecordRow;
    expect(edited.file).toEqual([
      file('senas.pdf'),
      { ...file('naujas.pdf', other), typeName: 'Kita' },
    ]);

    const [history] = await knex('recordHistories').where({ recordId: record.id });
    expect(history.changes.file.old).toEqual([file('senas.pdf')]);
  });

  it('keeps the stored type name when the type is renamed later', async () => {
    const record = await newRecord([file('aktas.pdf', other)]);
    await knex('documentTypeClassifiers').where({ id: other }).update({ name: 'Kitas dokumentas' });
    try {
      // Tas pats dokumentas su tuo pačiu tipu nekeičiamas — istorija nerašoma.
      await edit(record.id, [{ ...file('aktas.pdf', other) }]);
      expect(await knex('recordHistories').where({ recordId: record.id })).toEqual([]);
      expect((await knex('records').where({ id: record.id }).first()).file).toEqual([
        { ...file('aktas.pdf', other), typeName: 'Kita' },
      ]);
    } finally {
      await knex('documentTypeClassifiers').where({ id: other }).update({ name: 'Kita' });
    }
  });

  it('requires types for documents of a registered animal acquisition', async () => {
    const [classifier] = await activeClassifierIds(1);
    const individual = (
      (await broker.call(
        'species.newSpecies',
        {
          permit: await createPermitFixture({ permitNumber: 'DOC-2', users: [OWNER] }),
          speciesClassifier: classifier,
          possessionType: 'WITH_PERMIT',
          type: 'INDIVIDUAL',
        },
        { meta },
      )) as { id: number }
    ).id;
    const register = (files: RecordFile[]) =>
      broker.call(
        'animals.newAnimal',
        {
          species: individual,
          gender: 'MALE',
          birthDate: today(),
          acquiredFrom: { type: 'INDIVIDUAL', nationalityType: 'LOCAL', name: 'Pardavėjas' },
          acquireDate: today(),
          file: files,
        },
        { meta },
      );

    await expect(register([file('pirkimas.pdf')])).rejects.toMatchObject(TYPE_REQUIRED);
    // Gyvūnas nesukuriamas, kol dokumentai netinkami.
    expect(await knex('animals').where({ speciesId: individual })).toEqual([]);
    await expect(register([file('pirkimas.pdf', contract)])).resolves.toBeTruthy();
  });

  it('checks the documents of a fostered animal before registering it', async () => {
    const [classifier] = await activeClassifierIds(1);
    const register = (files: unknown) =>
      broker.call(
        'fosteredAnimals.newFosteredAnimal',
        {
          speciesClassifier: classifier,
          gender: 'FEMALE',
          address: 'Testo g. 1',
          municipality: { id: 13, name: 'Vilniaus m. sav.' },
          acquireType: 'FOUND',
          date: today(),
          files,
        },
        { meta },
      ) as Promise<{ id: number }>;
    const fosteredCount = async () =>
      Number((await knex('fosteredAnimals').count('id as count').first())!.count);
    const before = await fosteredCount();

    await expect(register([file('radimas.pdf')])).rejects.toMatchObject(TYPE_REQUIRED);
    await expect(register({ error: 'Upload failed' })).rejects.toMatchObject({
      code: 422,
      type: 'INVALID_FILES',
    });
    expect(await fosteredCount()).toBe(before);

    const fostered = await register([file('radimas.pdf', other)]);
    expect((await knex('records').where({ fosteredAnimalId: fostered.id }).first()).file).toEqual([
      { ...file('radimas.pdf', other), typeName: 'Kita' },
    ]);
  });
});
