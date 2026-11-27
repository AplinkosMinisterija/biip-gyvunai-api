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

const HOLDER = 5;

const deletingAdminMeta = () => {
  const meta = adminMeta();
  return {
    ...meta,
    authUser: { ...meta.authUser, permissions: { NLG: { accesses: ['DELETE_PERMITS'] } } },
  };
};

const insertId = (row: any) => Number(typeof row === 'object' ? row.id : row);

const insert = async (table: string, row: Record<string, unknown>): Promise<number> => {
  const [created] = await knex(table)
    .insert({ createdAt: new Date(), ...row })
    .returning('id');
  return insertId(created);
};

const PERMIT_REVOKED = { code: 422, type: 'PERMIT_REVOKED' };

// AAD sprendimai (#85, 5 ir 35 kl.): panaikintame leidime gyvūnų nebedaugėja — naujos rūšys ir
// gyvūnai neregistruojami, įsigijimo ir gimimo įrašai nekuriami. Kiti įrašai (perleidimas,
// paleidimas, gaišimas, gydymas, ženklinimas ir kt.) pildomi toliau, kol gyvūnai iškeliami.
describe('rules of a revoked permit (integration)', () => {
  let broker: ServiceBroker;
  let classifierId: number;
  let otherClassifierId: number;
  let revokedPermitId: number;
  let earlierRevokedPermitId: number;
  let activePermitId: number;
  let groupSpeciesId: number;
  let acquirementRecordId: number;
  let individualSpeciesId: number;
  let animalId: number;
  let earlierRevokedSpeciesId: number;
  let activeSpeciesId: number;

  const holder = () => userMeta({ userId: HOLDER });
  const today = () => new Date().toISOString();

  const newRecord = (params: Record<string, unknown>, meta: object = holder()) =>
    broker.call('records.newRecord', { date: today(), ...params }, { meta });

  const newAnimal = (species: number, meta: object = holder()) =>
    broker.call('animals.newAnimal', { species, gender: 'MALE', birthDate: today() }, { meta });

  const amountOf = async (id: number) =>
    Number((await knex('species').where({ id }).first('amount')).amount);

  const speciesOf = (permitId: number, row: Record<string, unknown>) =>
    insert('species', {
      permitId,
      speciesClassifierId: classifierId,
      possessionType: 'WITH_PERMIT',
      userId: HOLDER,
      ...row,
    });

  beforeAll(async () => {
    await resetDomainTables();
    broker = await createTestBroker();
    [classifierId, otherClassifierId] = await activeClassifierIds(2);

    revokedPermitId = await createPermitFixture({ permitNumber: 'RULE-NEW', users: [HOLDER] });
    earlierRevokedPermitId = await createPermitFixture({
      permitNumber: 'RULE-OLD',
      users: [HOLDER],
    });
    activePermitId = await createPermitFixture({ permitNumber: 'RULE-ACTIVE', users: [HOLDER] });
    await knex('permits')
      .whereIn('id', [revokedPermitId, earlierRevokedPermitId, activePermitId])
      .update({ municipality: JSON.stringify({ id: 13, name: 'Vilniaus m. sav.' }) });

    groupSpeciesId = await speciesOf(revokedPermitId, { type: 'GROUP', amount: 7 });
    acquirementRecordId = await insert('records', {
      speciesId: groupSpeciesId,
      permitId: revokedPermitId,
      type: 'ACQUIREMENT',
      numberOfAnimals: 7,
      date: new Date(),
      userId: HOLDER,
    });
    individualSpeciesId = await speciesOf(revokedPermitId, {
      speciesClassifierId: otherClassifierId,
      type: 'INDIVIDUAL',
      amount: 1,
    });
    animalId = await insert('animals', {
      speciesId: individualSpeciesId,
      permitId: revokedPermitId,
      gender: 'MALE',
      userId: HOLDER,
    });
    earlierRevokedSpeciesId = await speciesOf(earlierRevokedPermitId, { type: 'GROUP', amount: 0 });
    activeSpeciesId = await speciesOf(activePermitId, { type: 'GROUP', amount: 0 });

    // Leidimas, panaikintas iki šio pakeitimo: turi tik panaikinimo datą.
    await knex('permits')
      .where({ id: earlierRevokedPermitId })
      .update({ deletedAt: new Date('2026-01-15T10:00:00Z') });
    await broker.call(
      'permits.removePermit',
      { id: revokedPermitId, deleteReason: 'REQUESTED_CANCELLATION' },
      { meta: deletingAdminMeta() },
    );
  });

  afterAll(async () => {
    await broker.stop();
    await knex.destroy();
  });

  it('does not accept a new species', async () => {
    await expect(
      broker.call(
        'species.newSpecies',
        {
          permit: revokedPermitId,
          speciesClassifier: otherClassifierId,
          possessionType: 'WITH_PERMIT',
          type: 'GROUP',
        },
        { meta: holder() },
      ),
    ).rejects.toMatchObject({ code: 422, type: 'INVALID_PERMIT' });
  });

  it('does not accept a new animal, from the holder or an admin', async () => {
    await expect(newAnimal(individualSpeciesId)).rejects.toMatchObject(PERMIT_REVOKED);
    await expect(newAnimal(individualSpeciesId, adminMeta())).rejects.toMatchObject(PERMIT_REVOKED);

    expect(await knex('animals').where({ speciesId: individualSpeciesId })).toHaveLength(1);
  });

  it.each(['ACQUIREMENT', 'BIRTH'])(
    'does not accept a %s record for a species kept in groups',
    async (type) => {
      await expect(
        newRecord({ type, species: groupSpeciesId, numberOfAnimals: 2 }),
      ).rejects.toMatchObject(PERMIT_REVOKED);

      expect(await amountOf(groupSpeciesId)).toBe(7);
    },
  );

  it.each(['ACQUIREMENT', 'BIRTH'])('does not accept a %s record for an animal', async (type) => {
    await expect(newRecord({ type, animal: animalId })).rejects.toMatchObject(PERMIT_REVOKED);

    expect(await knex('records').where({ animalId })).toHaveLength(0);
  });

  it('applies the same to a permit revoked before the new rules', async () => {
    await expect(
      newRecord({ type: 'ACQUIREMENT', species: earlierRevokedSpeciesId, numberOfAnimals: 1 }),
    ).rejects.toMatchObject(PERMIT_REVOKED);
  });

  it('still accepts the records that take animals out of the permit', async () => {
    await newRecord({ type: 'SALE', species: groupSpeciesId, numberOfAnimals: 2 });
    await newRecord({ type: 'DEATH', species: groupSpeciesId, numberOfAnimals: 1 });
    await newRecord({ type: 'TRANSFER', species: groupSpeciesId, numberOfAnimals: 1 });
    await newRecord({ type: 'RELEASE', species: groupSpeciesId, numberOfAnimals: 1 });

    expect(await amountOf(groupSpeciesId)).toBe(2);
  });

  it('still accepts records that do not change the number of animals', async () => {
    await newRecord({ type: 'VACCINATION', animal: animalId });
    await newRecord({ type: 'TREATMENT', animal: animalId });
    await newRecord({ type: 'OTHER', species: groupSpeciesId, note: 'Patikra' });

    expect(await knex('records').where({ animalId })).toHaveLength(2);
  });

  it('keeps accepting everything in an active permit', async () => {
    await newRecord({ type: 'ACQUIREMENT', species: activeSpeciesId, numberOfAnimals: 3 });

    expect(await amountOf(activeSpeciesId)).toBe(3);
  });

  // Laikytojas gyvūnų skaičiaus nepadidina ir taisydamas ar anuliuodamas senus įrašus; AAD gali.
  describe('corrections', () => {
    const edit = (numberOfAnimals: number, meta: object) =>
      broker.call(
        'records.edit',
        { id: acquirementRecordId, reason: 'Patikslintas skaičius', numberOfAnimals },
        { meta },
      );
    const annul = (id: number, meta: object) =>
      broker.call('records.annul', { id, reason: 'Įvesta per klaidą' }, { meta });

    it('the holder cannot raise the number of animals of an old acquisition', async () => {
      await expect(edit(9, holder())).rejects.toMatchObject(PERMIT_REVOKED);

      expect(await amountOf(groupSpeciesId)).toBe(2);
    });

    it('the holder can lower it, and an admin can raise it back', async () => {
      await edit(6, holder());
      expect(await amountOf(groupSpeciesId)).toBe(1);

      await edit(7, adminMeta());
      expect(await amountOf(groupSpeciesId)).toBe(2);
    });

    it('the holder cannot bring animals back by annulling a record that took them out', async () => {
      const death = (await newRecord({
        type: 'DEATH',
        species: groupSpeciesId,
        numberOfAnimals: 1,
      })) as { id: number };
      expect(await amountOf(groupSpeciesId)).toBe(1);

      await expect(annul(death.id, holder())).rejects.toMatchObject(PERMIT_REVOKED);
      expect(await amountOf(groupSpeciesId)).toBe(1);

      await annul(death.id, adminMeta());
      expect(await amountOf(groupSpeciesId)).toBe(2);
    });

    it('the holder can still annul a record that does not bring animals back', async () => {
      const note = (await newRecord({
        type: 'OTHER',
        species: groupSpeciesId,
        note: 'Klaidingas įrašas',
      })) as { id: number };

      await expect(annul(note.id, holder())).resolves.toMatchObject({ id: note.id });
    });
  });

  // Vieša statistika: gyvūnai skaičiuojami, kol išregistruojami, o pats panaikintas leidimas
  // į leidimų (zoologijos sodų ir aptvarų) skaičius nebeįeina.
  it('counts the remaining animals in public statistics, but not the permit', async () => {
    const general: { speciesCount: number; zoosCount: number } = await broker.call(
      'permits.generalStatistic',
    );
    const byMunicipality: { count: number; permitsCount: number }[] = await broker.call(
      'species.publicSpeciesByMunicipalityAll',
      {},
    );

    // 2 (grupinė rūšis) + 1 (individas) panaikintame leidime, 3 galiojančiame.
    expect(general.speciesCount).toBe(6);
    expect(general.zoosCount).toBe(1);
    expect(byMunicipality).toEqual([expect.objectContaining({ count: 6, permitsCount: 1 })]);
  });

  it('an individually kept animal can still be recorded as sold', async () => {
    await newRecord({ type: 'SALE', animal: animalId });

    expect(await amountOf(individualSpeciesId)).toBe(0);
  });

  describe('after the revocation is undone', () => {
    beforeAll(async () => {
      await broker.call(
        'permits.restorePermit',
        { id: revokedPermitId, reason: 'Klaidingai panaikintas' },
        { meta: deletingAdminMeta() },
      );
    });

    it('accepts new animals and acquisition records again', async () => {
      await newAnimal(individualSpeciesId);
      await newRecord({ type: 'ACQUIREMENT', species: groupSpeciesId, numberOfAnimals: 4 });

      expect(await knex('animals').where({ speciesId: individualSpeciesId })).toHaveLength(2);
      expect(await amountOf(groupSpeciesId)).toBe(6);
    });
  });
});
