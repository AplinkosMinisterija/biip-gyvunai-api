'use strict';

import { ServiceBroker } from 'moleculer';
import {
  adminMeta,
  createPermitFixture,
  createTestBroker,
  knex,
  resetDomainTables,
} from './helpers/testBroker';

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

const deletedAtOf = async (table: string, id: number) =>
  (await knex(table).where({ id }).first('deletedAt')).deletedAt;

describe('permit deletion (integration)', () => {
  let broker: ServiceBroker;
  let permitId: number;
  let speciesId: number;
  let animalId: number;
  let recordId: number;
  let animalRecordId: number;
  let permitSpeciesId: number;
  let earlierRemovedRecordId: number;
  const earlierRemovedAt = new Date('2026-01-15T10:00:00Z');
  const removedEvents: unknown[] = [];

  beforeAll(async () => {
    await resetDomainTables();
    broker = await createTestBroker();
    broker.createService({
      name: 'removedEventSpy',
      events: {
        'permits.removed': (ctx: { params: unknown }) => {
          removedEvents.push(ctx.params);
        },
      },
    });
    await broker.waitForServices(['removedEventSpy']);

    permitId = await createPermitFixture({ permitNumber: 'DEL-PERMIT-1', users: [5] });
    await knex('permits')
      .where({ id: permitId })
      .update({
        municipality: JSON.stringify({ id: 13, name: 'Vilniaus m. sav.' }),
        cadastralIds: JSON.stringify([{ cadastral_number: '4400-0000-0001' }]),
      });
    permitSpeciesId = await insert('permitSpecies', { permitId, speciesClassifierId: 1 });
    speciesId = await insert('species', {
      permitId,
      speciesClassifierId: 1,
      possessionType: 'WITH_PERMIT',
      type: 'GROUP',
      amount: 7,
    });
    animalId = await insert('animals', { speciesId, permitId, gender: 'MALE' });
    recordId = await insert('records', {
      speciesId,
      permitId,
      type: 'ACQUIREMENT',
      numberOfAnimals: 7,
      date: new Date(),
    });
    animalRecordId = await insert('records', { animalId, type: 'BIRTH', date: new Date() });
    earlierRemovedRecordId = await insert('records', {
      speciesId,
      permitId,
      type: 'OTHER',
      date: new Date(),
      deletedAt: earlierRemovedAt,
    });
    await knex.raw('REFRESH MATERIALIZED VIEW public_permits_by_cadastral_ids');

    await broker.call(
      'permits.removePermit',
      { id: permitId, deleteReason: 'REQUESTED_CANCELLATION' },
      { meta: deletingAdminMeta() },
    );
  });

  afterAll(async () => {
    await broker.stop();
    await knex.destroy();
  });

  // AAD patikslinimas (#85, 5 kl., 2026-10-21): gyvūnai lieka, kol perduodami per žurnalo įrašus.
  it('marks only the permit deleted and keeps its species, animals and records', async () => {
    expect(await deletedAtOf('permits', permitId)).not.toBeNull();
    for (const [table, id] of [
      ['species', speciesId],
      ['animals', animalId],
      ['records', recordId],
      ['records', animalRecordId],
      ['permitSpecies', permitSpeciesId],
    ] as const) {
      expect(await deletedAtOf(table, id)).toBeNull();
    }
  });

  it('returns 404 when the permit is already deleted', async () => {
    await expect(
      broker.call(
        'permits.removePermit',
        { id: permitId, deleteReason: 'REQUESTED_CANCELLATION' },
        { meta: deletingAdminMeta() },
      ),
    ).rejects.toMatchObject({ code: 404 });
  });

  it('announces the removal so the public views are refreshed', () => {
    expect(removedEvents).toEqual([
      expect.objectContaining({ type: 'remove', data: { id: permitId } }),
    ]);
  });

  it('keeps the earlier deletion date of a record removed before', async () => {
    expect(await deletedAtOf('records', earlierRemovedRecordId)).toEqual(earlierRemovedAt);
  });

  // Vieša statistika ir toliau skaičiuoja panaikinto leidimo gyvūnus (kaip iki šiol); kaip turi
  // būti, laukiama AAD atsakymo (#85, 35 kl.).
  it('keeps counting the animals of the deleted permit in public statistics', async () => {
    const general: { speciesCount: number } = await broker.call('permits.generalStatistic');
    const publicSpecies: { count: number }[] = await broker.call(
      'species.publicSpeciesByMunicipalityAll',
      {},
    );

    expect(general.speciesCount).toBe(7);
    expect(publicSpecies).toEqual([expect.objectContaining({ count: 7 })]);
  });

  it('removes the permit from the public cadastral search', async () => {
    await knex.raw('REFRESH MATERIALIZED VIEW public_permits_by_cadastral_ids');
    const rows = await knex('publicPermitsByCadastralIds').where({
      cadastralNumber: '4400-0000-0001',
    });

    expect(rows).toEqual([]);
  });

  it('lets an admin read the data of a deleted permit with the permit filled', async () => {
    const species = (await broker.call(
      'species.list',
      { query: { permit: permitId }, populate: ['permit'] },
      { meta: adminMeta() },
    )) as { rows: { id: number; permit: { id: number; permitNumber: string } }[] };
    const records: { rows: { id: number }[] } = await broker.call(
      'records.list',
      { query: { permit: permitId } },
      { meta: adminMeta() },
    );

    expect(species.rows.map(({ id }) => id)).toEqual([speciesId]);
    expect(species.rows[0].permit).toMatchObject({ id: permitId, permitNumber: 'DEL-PERMIT-1' });
    expect(records.rows.map(({ id }) => id)).toEqual([recordId]);
  });

  describe('restore', () => {
    const restore = (id: number, reason: string, meta: object = deletingAdminMeta()) =>
      broker.call('permits.restorePermit', { id, reason }, { meta });

    it('requires the right to delete permits and a reason', async () => {
      await expect(restore(permitId, 'Klaidingai panaikintas', adminMeta())).rejects.toMatchObject({
        code: 401,
      });
      await expect(restore(permitId, '   ')).rejects.toMatchObject({ code: 422 });
    });

    it('refuses to restore when an active permit with the same number exists', async () => {
      const duplicate = await createPermitFixture({ permitNumber: 'DEL-PERMIT-1' });

      await expect(restore(permitId, 'Klaidingai panaikintas')).rejects.toMatchObject({
        code: 400,
      });
      await knex('permits').where({ id: duplicate }).delete();
    });

    it('restores the permit and leaves its data as it was', async () => {
      await restore(permitId, 'Klaidingai panaikintas');

      for (const [table, id] of [
        ['permits', permitId],
        ['species', speciesId],
        ['animals', animalId],
        ['records', recordId],
        ['records', animalRecordId],
        ['permitSpecies', permitSpeciesId],
      ] as const) {
        expect(await deletedAtOf(table, id)).toBeNull();
      }
      expect(await deletedAtOf('records', earlierRemovedRecordId)).toEqual(earlierRemovedAt);
    });

    it('records who restored the permit and why', async () => {
      const history = await knex('permitHistories')
        .where({ permitId })
        .orderBy('id')
        .select('type', 'restoreReason', 'createdBy');

      expect(history.map(({ type }: { type: string }) => type)).toEqual(['DELETED', 'RESTORED']);
      expect(history[1]).toMatchObject({ restoreReason: 'Klaidingai panaikintas', createdBy: 1 });
    });

    it('returns 404 for a permit that is not deleted', async () => {
      await expect(restore(permitId, 'Dar kartą')).rejects.toMatchObject({ code: 404 });
    });
  });
});
