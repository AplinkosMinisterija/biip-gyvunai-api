'use strict';

import { Knex } from 'knex';
import { knex } from '../helpers/testBroker';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const merge = require('../../database/migrations/20261026120000_mergeLatinNameDuplicates.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const uniqueIndex = require('../../database/migrations/20261026120100_uniqueSpeciesClassifierLatinName.js');

const insertId = (row: any) => Number(typeof row === 'object' ? row.id : row);
const NBSP = ' ';

// Migracijos keičia klasifikatorius ir indeksus, todėl testas vyksta transakcijoje, kuri
// pabaigoje atšaukiama.
let trx: Knex.Transaction;

const insert = async (table: string, row: Record<string, unknown>): Promise<number> => {
  const [created] = await trx(table)
    .insert({ createdAt: new Date(), ...row })
    .returning('id');
  return insertId(created);
};

const classifierOf = async (table: string, id: number): Promise<number> =>
  (await trx(table).where({ id }).first('speciesClassifierId')).speciesClassifierId;

const isDeleted = async (id: number) =>
  !!(await trx('speciesClassifiers').where({ id }).first('deletedAt')).deletedAt;

const indexExists = async () =>
  !!(
    await trx.raw(
      `SELECT 1 FROM pg_indexes WHERE indexname = 'species_classifiers_name_latin_unique'`,
    )
  ).rows.length;

describe('migrations: merge Latin name duplicates and make the Latin name unique', () => {
  let familyId: number;
  let otherFamilyId: number;
  let kept: number;
  let keptTwin: number;
  let dropped: number;
  let lonelyDrop: number;
  let permitId: number;
  let speciesId: number;
  let animalId: number;
  let recordId: number;
  let fosteredId: number;
  let keptPermitSpecies: number;

  beforeAll(async () => {
    trx = await knex.transaction();
    await trx.raw('DROP INDEX IF EXISTS species_classifiers_name_latin_unique');
    await trx.raw('TRUNCATE records, animals, species, permit_species, permit_histories, permits');
    // Testinės DB klasifikatoriai su tais pačiais pavadinimais šiame teste nedalyvauja.
    await trx('speciesClassifiers')
      .whereRaw(`name_latin ILIKE ANY (ARRAY['cairina%', 'platycercus%'])`)
      .update({ deletedAt: new Date() });

    familyId = await insert('familyClassifiers', {
      name: 'Testinės antys',
      nameLatin: 'Anatidae migratio',
    });
    otherFamilyId = await insert('familyClassifiers', {
      name: 'Kitos testinės antys',
      nameLatin: 'Anatidae alia migratio',
    });
    kept = await insert('speciesClassifiers', {
      name: 'Muskusinė antis',
      nameLatin: `Cairina${NBSP}moschata`,
      familyClassifierId: familyId,
    });
    // Antras paliekamo pavadinimo įrašas be šeimos — taip pat sujungiamas.
    keptTwin = await insert('speciesClassifiers', {
      name: 'muskusinė  antis',
      nameLatin: 'Cairina moschata',
    });
    dropped = await insert('speciesClassifiers', {
      name: 'Paprastoji  muskusinė antis ',
      nameLatin: 'cairina  moschata',
      familyClassifierId: otherFamilyId,
    });
    // Poros paliekamo įrašo („Raudonoji rozela“) šioje aplinkoje nėra — pora praleidžiama.
    lonelyDrop = await insert('speciesClassifiers', {
      name: 'Penantinė rozela',
      nameLatin: 'Platycercus elegans',
      familyClassifierId: familyId,
    });

    permitId = await insert('permits', {
      permitNumber: 'MIG-LATIN-1',
      issueDate: new Date('2026-01-01'),
      issuerId: 1,
      type: 'AVIARY',
    });
    keptPermitSpecies = await insert('permitSpecies', { permitId, speciesClassifierId: kept });
    await insert('permitSpecies', {
      permitId,
      speciesClassifierId: dropped,
      familyClassifierId: otherFamilyId,
    });
    speciesId = await insert('species', {
      permitId,
      speciesClassifierId: dropped,
      possessionType: 'WITH_PERMIT',
      type: 'INDIVIDUAL',
    });
    animalId = await insert('animals', {
      speciesId,
      speciesClassifierId: keptTwin,
      gender: 'MALE',
    });
    recordId = await insert('records', {
      animalId,
      speciesClassifierId: dropped,
      type: 'BIRTH',
      date: new Date(),
    });
    fosteredId = await insert('fosteredAnimals', { speciesClassifierId: dropped });

    await merge.up(trx);
  });

  afterAll(async () => {
    await trx.rollback();
    await knex.destroy();
  });

  it('moves species, animals, records and fostered animals to the kept classifier', async () => {
    expect(await classifierOf('species', speciesId)).toBe(kept);
    expect(await classifierOf('animals', animalId)).toBe(kept);
    expect(await classifierOf('records', recordId)).toBe(kept);
    expect(await classifierOf('fosteredAnimals', fosteredId)).toBe(kept);
  });

  it('keeps the named classifier with a family and deletes the others', async () => {
    expect(await isDeleted(kept)).toBe(false);
    expect(await isDeleted(keptTwin)).toBe(true);
    expect(await isDeleted(dropped)).toBe(true);
  });

  it('skips a pair whose kept classifier does not exist', async () => {
    expect(await isDeleted(lonelyDrop)).toBe(false);
  });

  it('leaves one permit row with the kept family when the permit listed both', async () => {
    const rows = await trx('permitSpecies')
      .where({ permitId })
      .whereNull('deletedAt')
      .select('id', 'speciesClassifierId', 'familyClassifierId');

    expect(rows).toEqual([
      { id: keptPermitSpecies, speciesClassifierId: kept, familyClassifierId: null },
    ]);
    expect(
      await trx('permitSpecies')
        .where({ permitId })
        .whereNotNull('deletedAt')
        .first('speciesClassifierId', 'familyClassifierId'),
    ).toEqual({ speciesClassifierId: kept, familyClassifierId: familyId });
  });

  it('changes nothing when run again', async () => {
    await merge.up(trx);

    expect(await classifierOf('species', speciesId)).toBe(kept);
    expect(await isDeleted(kept)).toBe(false);
  });

  describe('unique Latin name', () => {
    it('skips the index while duplicates remain instead of failing the boot', async () => {
      const savepoint = await trx.transaction();
      await savepoint('speciesClassifiers').insert({
        name: 'Dar viena rozela',
        nameLatin: `platycercus${NBSP}Elegans `,
        createdAt: new Date(),
      });
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      await uniqueIndex.up(savepoint);

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('platycercus elegans'));
      expect(
        (
          await savepoint.raw(
            `SELECT 1 FROM pg_indexes WHERE indexname = 'species_classifiers_name_latin_unique'`,
          )
        ).rows,
      ).toEqual([]);
      warn.mockRestore();
      await savepoint.rollback();
    });

    it('rejects a second active classifier whose Latin name differs only in spaces', async () => {
      await uniqueIndex.up(trx);
      expect(await indexExists()).toBe(true);

      const savepoint = await trx.transaction();
      await expect(
        savepoint('speciesClassifiers').insert({
          name: 'Kita antis',
          nameLatin: ' CAIRINA  moschata',
          createdAt: new Date(),
        }),
      ).rejects.toThrow(/species_classifiers_name_latin_unique/);
      await savepoint.rollback();
    });

    it('allows the Latin name of a deleted classifier', async () => {
      await expect(
        insert('speciesClassifiers', {
          name: 'Panaikinta antis',
          nameLatin: 'Cairina moschata',
          deletedAt: new Date(),
        }),
      ).resolves.toEqual(expect.any(Number));
    });
  });
});
