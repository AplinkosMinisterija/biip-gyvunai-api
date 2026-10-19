'use strict';

import { ServiceBroker } from 'moleculer';
import {
  activeClassifierIds,
  createPermitFixture,
  createTestBroker,
  knex,
  resetDomainTables,
} from './helpers/testBroker';

const MUNICIPALITY = { id: 13, name: 'Vilniaus m. sav.' };
const KG_ONLY_MUNICIPALITY = { id: 41, name: 'Širvintų r. sav.' };

describe('public statistics count kilograms separately (integration)', () => {
  let broker: ServiceBroker;
  let unitClassifier: number;
  let kgClassifier: number;

  beforeAll(async () => {
    await resetDomainTables();
    broker = await createTestBroker();
    [unitClassifier, kgClassifier] = await activeClassifierIds(2);

    const permit = await createPermitFixture({ permitNumber: 'STAT-KG-1' });
    await knex('permits')
      .where({ id: permit })
      .update({ municipality: JSON.stringify(MUNICIPALITY) });

    // Savivaldybė, kurioje yra tik kilogramais apskaitoma rūšis, turi likti sąrašuose.
    const kgOnlyPermit = await createPermitFixture({ permitNumber: 'STAT-KG-2' });
    await knex('permits')
      .where({ id: kgOnlyPermit })
      .update({ municipality: JSON.stringify(KG_ONLY_MUNICIPALITY) });

    await knex('species').insert(
      [
        { permitId: permit, speciesClassifierId: unitClassifier, units: 'UNIT', amount: 3 },
        // Senos rūšys be vieneto skaičiuojamos vienetais.
        { permitId: permit, speciesClassifierId: unitClassifier, units: null, amount: 2 },
        { permitId: permit, speciesClassifierId: kgClassifier, units: 'KG', amount: 12 },
        { permitId: kgOnlyPermit, speciesClassifierId: kgClassifier, units: 'KG', amount: 4 },
      ].map((row) => ({
        ...row,
        possessionType: 'WITH_PERMIT',
        type: 'GROUP',
        createdAt: new Date(),
      })),
    );
  });

  afterAll(async () => {
    await broker.stop();
    await knex.destroy();
  });

  it('keeps kilograms out of the unit count in the general statistic', async () => {
    const general = await broker.call('permits.generalStatistic');

    expect(general).toMatchObject({ speciesCount: 5, speciesCountKg: 16 });
  });

  it('returns kilograms separately per municipality and species', async () => {
    const rows = (await broker.call('species.publicSpeciesByMunicipalityAll', {})) as {
      municipality: { id: number };
      count: number;
      countKg: number;
      speciesClassifier: { id: number; count: number; countKg: number }[];
    }[];

    const vilnius = rows.find((row) => row.municipality.id === MUNICIPALITY.id);
    const kgOnly = rows.find((row) => row.municipality.id === KG_ONLY_MUNICIPALITY.id);

    expect(rows).toHaveLength(2);
    expect(kgOnly).toMatchObject({ count: 0, countKg: 4, permitsCount: 1 });
    expect(vilnius).toMatchObject({ count: 5, countKg: 12 });
    expect(vilnius?.speciesClassifier).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: unitClassifier, count: 5, countKg: 0 }),
        expect.objectContaining({ id: kgClassifier, count: 0, countKg: 12 }),
      ]),
    );
  });

  it('returns kilograms per species when grouped by municipality and species', async () => {
    const rows = (await broker.call('species.publicSpeciesByMunicipalityAll', {
      groupBy: 'MUNICIPALITY_AND_SPECIES_CLASSIFIER',
    })) as { count: number; countKg: number; speciesClassifier: { id: number } }[];

    const kgRows = rows.filter((row) => row.speciesClassifier.id === kgClassifier);
    expect(kgRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ count: 0, countKg: 12 }),
        expect.objectContaining({ count: 0, countKg: 4, permitsCount: 1 }),
      ]),
    );
  });
});
