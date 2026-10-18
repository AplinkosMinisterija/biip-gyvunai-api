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

describe('permit deletion cascade (integration)', () => {
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

    permitId = await createPermitFixture({ permitNumber: 'DEL-CASCADE-1', users: [5] });
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

  it('marks species, animals, records and permit species deleted with the permit date', async () => {
    const permitDeletedAt = await deletedAtOf('permits', permitId);

    expect(permitDeletedAt).not.toBeNull();
    for (const [table, id] of [
      ['species', speciesId],
      ['animals', animalId],
      ['records', recordId],
      ['records', animalRecordId],
      ['permitSpecies', permitSpeciesId],
    ] as const) {
      expect(await deletedAtOf(table, id)).toEqual(permitDeletedAt);
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

  it('removes the permit species from public statistics', async () => {
    const general: { speciesCount: number } = await broker.call('permits.generalStatistic');
    const publicSpecies: unknown[] = await broker.call(
      'species.publicSpeciesByMunicipalityAll',
      {},
    );

    expect(general.speciesCount).toBe(0);
    expect(publicSpecies).toEqual([]);
  });

  it('removes the permit from the public cadastral search', async () => {
    await knex.raw('REFRESH MATERIALIZED VIEW public_permits_by_cadastral_ids');
    const rows = await knex('publicPermitsByCadastralIds').where({
      cadastralNumber: '4400-0000-0001',
    });

    expect(rows).toEqual([]);
  });

  it('lets an admin read the deleted data with the deleted scope', async () => {
    const species: { rows: { id: number }[] } = await broker.call(
      'species.list',
      { query: { permit: permitId }, scope: 'deleted' },
      { meta: adminMeta() },
    );
    const records: { rows: { id: number }[] } = await broker.call(
      'records.list',
      { query: { permit: permitId }, scope: 'deleted' },
      { meta: adminMeta() },
    );

    expect(species.rows.map(({ id }) => id)).toEqual([speciesId]);
    expect(records.rows.map(({ id }) => id).sort()).toEqual(
      [recordId, earlierRemovedRecordId].sort(),
    );
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
      const duplicate = await createPermitFixture({ permitNumber: 'DEL-CASCADE-1' });

      await expect(restore(permitId, 'Klaidingai panaikintas')).rejects.toMatchObject({
        code: 400,
      });
      await knex('permits').where({ id: duplicate }).delete();
    });

    it('restores the permit with the data deleted together with it', async () => {
      await knex('species').where({ id: speciesId }).update({ amount: 999 });

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
      expect((await knex('species').where({ id: speciesId }).first('amount')).amount).toBe(7);
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
