'use strict';

import { Knex } from 'knex';
import { knex } from '../helpers/testBroker';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const migration = require('../../database/migrations/20261018120000_mergeDanieliusAndFixPermitRowSpecies.js');

const insertId = (row: any) => Number(typeof row === 'object' ? row.id : row);

// Migracija keičia visus danieliaus klasifikatorius, tarp jų ir kitų testų naudojamus,
// todėl testas vyksta transakcijoje, kuri pabaigoje atšaukiama.
let trx: Knex.Transaction;

const insert = async (table: string, row: Record<string, unknown>): Promise<number> => {
  const [created] = await trx(table)
    .insert({ createdAt: new Date(), ...row })
    .returning('id');
  return insertId(created);
};

const classifierOf = async (table: string, id: number): Promise<number> =>
  (await trx(table).where({ id }).first('speciesClassifierId')).speciesClassifierId;

describe('migration: merge Danielius and fix species saved with a permit row id', () => {
  const classifierIds: number[] = [];
  let familyId: number;
  let danielius: number;
  let cervusDama: number;
  let cervusDamaNoFamily: number;
  let tiger: number;
  let otherDanieliai: number;

  const permit = (permitNumber: string) =>
    insert('permits', {
      permitNumber,
      issueDate: new Date('2026-01-01'),
      issuerId: 1,
      type: 'AVIARY',
    });

  beforeAll(async () => {
    trx = await knex.transaction();
    await trx.raw('TRUNCATE records, animals, species, permit_species, permit_histories, permits');
    // Ši migracija vykdoma prieš lotyniško pavadinimo indeksą (20261026120100), todėl jo dar
    // nėra — kitaip nebūtų galima sukurti dublikatų, kuriuos migracija sujungia.
    await trx.raw('DROP INDEX IF EXISTS species_classifiers_name_latin_unique');
    // Testinės DB pradiniai danieliai šiame teste nedalyvauja.
    await trx('speciesClassifiers')
      .whereRaw("lower(btrim(name)) = 'danielius'")
      .update({ name: 'Pradinis danielius (testas)' });

    familyId = await insert('familyClassifiers', {
      name: 'Testiniai elniniai',
      nameLatin: 'Cervidae migratio',
    });

    // Kaip staging: keli aktyvūs danieliai, dalis be šeimos.
    cervusDamaNoFamily = await insert('speciesClassifiers', {
      name: 'Danielius',
      nameLatin: 'Cervus dama',
    });
    danielius = await insert('speciesClassifiers', {
      name: 'Danielius',
      nameLatin: 'Dama  dama',
      familyClassifierId: familyId,
    });
    cervusDama = await insert('speciesClassifiers', {
      name: ' Danielius ',
      nameLatin: 'Cervus dama',
      familyClassifierId: familyId,
    });
    tiger = await insert('speciesClassifiers', {
      name: 'Testinis tigras',
      nameLatin: 'Panthera migratio',
      familyClassifierId: familyId,
    });
    otherDanieliai = await insert('speciesClassifiers', {
      name: 'Danieliai',
      nameLatin: 'Cervus dama sin. Dama dama',
    });
    classifierIds.push(danielius, cervusDama, cervusDamaNoFamily, tiger, otherDanieliai);
  });

  afterAll(async () => {
    await trx.rollback();
    await knex.destroy();
  });

  describe('first run', () => {
    let bothPermit: number;
    let bothRows: number[];
    let loserSpecies: number;
    let loserRecord: number;
    let loserAnimal: number;
    let loserFostered: number;
    let brokenPermit: number;
    let brokenSpecies: number;
    let brokenAnimal: number;
    let brokenRecord: number;
    let brokenAnimalRecord: number;
    let coincidentSpecies: number;

    beforeAll(async () => {
      bothPermit = await permit('MIG-1');
      bothRows = [
        await insert('permitSpecies', {
          permitId: bothPermit,
          speciesClassifierId: danielius,
          familyClassifierId: familyId,
        }),
        await insert('permitSpecies', {
          permitId: bothPermit,
          speciesClassifierId: cervusDamaNoFamily,
        }),
      ];
      loserSpecies = await insert('species', {
        permitId: bothPermit,
        speciesClassifierId: cervusDama,
        possessionType: 'WITH_PERMIT',
        type: 'GROUP',
      });
      loserRecord = await insert('records', {
        speciesId: loserSpecies,
        speciesClassifierId: cervusDama,
        type: 'ACQUIREMENT',
        date: new Date(),
      });
      loserFostered = await insert('fosteredAnimals', { speciesClassifierId: cervusDama });
      loserAnimal = await insert('animals', {
        speciesId: loserSpecies,
        speciesClassifierId: cervusDamaNoFamily,
        gender: 'MALE',
      });

      // Išorinės sistemos klaida: rūšiai išsaugotas leidimo eilutės id (kaip PROD 231 ir 54).
      brokenPermit = await permit('MIG-2');
      const brokenRow = await insert('permitSpecies', {
        permitId: brokenPermit,
        speciesClassifierId: cervusDama,
        familyClassifierId: familyId,
      });
      brokenSpecies = await insert('species', {
        permitId: brokenPermit,
        speciesClassifierId: brokenRow,
        possessionType: 'WITH_PERMIT',
        type: 'INDIVIDUAL',
      });
      brokenAnimal = await insert('animals', {
        speciesId: brokenSpecies,
        speciesClassifierId: brokenRow,
        gender: 'FEMALE',
      });
      brokenRecord = await insert('records', {
        speciesId: brokenSpecies,
        speciesClassifierId: brokenRow,
        type: 'ACQUIREMENT',
        date: new Date(),
      });
      brokenAnimalRecord = await insert('records', {
        animalId: brokenAnimal,
        speciesClassifierId: brokenRow,
        type: 'BIRTH',
        date: new Date(),
      });

      // Rūšies klasifikatoriaus id sutampa su leidimo eilutės id, bet rūšis leidimą atitinka.
      const coincidentPermit = await permit('MIG-3');
      await insert('permitSpecies', {
        permitId: coincidentPermit,
        speciesClassifierId: tiger,
        familyClassifierId: familyId,
      });
      const coincidentRow = await insert('permitSpecies', {
        permitId: coincidentPermit,
        speciesClassifierId: danielius,
        familyClassifierId: familyId,
      });
      // Eilutės id prilyginamas rūšies klasifikatoriui (tigrui) — tikrinama, kad sutapimas be
      // neatitikimo leidimui rūšies nepakeičia. Lentelė išvalyta transakcijos pradžioje,
      // todėl toks id su kitomis eilutėmis nesutampa.
      await trx('permitSpecies').where({ id: coincidentRow }).update({ id: tiger });
      coincidentSpecies = await insert('species', {
        permitId: coincidentPermit,
        speciesClassifierId: tiger,
        possessionType: 'WITH_PERMIT',
        type: 'GROUP',
      });

      await migration.up(trx);
    });

    it('keeps one Danielius named "Dama dama" with a family', async () => {
      const active = await trx('speciesClassifiers')
        .whereIn('id', [danielius, cervusDama, cervusDamaNoFamily])
        .whereNull('deletedAt');

      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({
        id: danielius,
        nameLatin: 'Dama dama',
        familyClassifierId: familyId,
      });
    });

    it('leaves a differently named classifier alone', async () => {
      const row = await trx('speciesClassifiers').where({ id: otherDanieliai }).first();
      expect(row.deletedAt).toBeNull();
    });

    it('moves species, records and animals to the kept classifier', async () => {
      expect(await classifierOf('species', loserSpecies)).toBe(danielius);
      expect(await classifierOf('records', loserRecord)).toBe(danielius);
      expect(await classifierOf('animals', loserAnimal)).toBe(danielius);
      expect(await classifierOf('fosteredAnimals', loserFostered)).toBe(danielius);
    });

    it('refreshes the public permit species view', async () => {
      const rows = await trx('publicPermitSpecies').whereIn('speciesId', [
        danielius,
        cervusDama,
        cervusDamaNoFamily,
      ]);

      expect(rows.map((row: { speciesId: number }) => row.speciesId)).toEqual([danielius]);
    });

    it('leaves one permit row when a permit listed both', async () => {
      const rows = await trx('permitSpecies')
        .whereIn('id', bothRows)
        .whereNull('deletedAt')
        .select('id', 'speciesClassifierId', 'familyClassifierId');

      expect(rows).toEqual([
        { id: bothRows[0], speciesClassifierId: danielius, familyClassifierId: familyId },
      ]);
    });

    it('fixes a species saved with a permit row id, with its animals and records', async () => {
      expect(await classifierOf('species', brokenSpecies)).toBe(danielius);
      expect(await classifierOf('animals', brokenAnimal)).toBe(danielius);
      expect(await classifierOf('records', brokenRecord)).toBe(danielius);
      expect(await classifierOf('records', brokenAnimalRecord)).toBe(danielius);
    });

    it('does not touch a species allowed by its permit', async () => {
      expect(await classifierOf('species', coincidentSpecies)).toBe(tiger);
    });

    it('changes nothing when run again', async () => {
      const snapshot = async () => ({
        classifiers: await trx('speciesClassifiers').whereIn('id', classifierIds).orderBy('id'),
        species: await trx('species').orderBy('id'),
        records: await trx('records').orderBy('id'),
        animals: await trx('animals').orderBy('id'),
        fosteredAnimals: await trx('fosteredAnimals').orderBy('id'),
        permitSpecies: await trx('permitSpecies').orderBy('id'),
      });
      const before = await snapshot();

      await migration.up(trx);

      expect(await snapshot()).toEqual(before);
    });
  });
});
