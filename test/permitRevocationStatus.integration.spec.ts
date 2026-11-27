'use strict';

import { ServiceBroker } from 'moleculer';
import { PermitStatus } from '../modules/permitStatus';
import {
  adminMeta,
  createPermitFixture,
  createTestBroker,
  knex,
  resetDomainTables,
  userMeta,
} from './helpers/testBroker';

const HOLDER = 5;
const STRANGER = 6;
const TENANT_MEMBER = 7;
const TENANT = 3;

const deletingAdminMeta = () => {
  const meta = adminMeta();
  return {
    ...meta,
    authUser: { ...meta.authUser, permissions: { NLG: { accesses: ['DELETE_PERMITS'] } } },
  };
};

type PermitRow = { id: number; status: PermitStatus; deletedAt?: string };

const statusById = (permits: PermitRow[]) =>
  Object.fromEntries(permits.map(({ id, status }) => [id, status]));

// AAD sprendimas (#85, 35 kl., 2026-11-26): statusas „Leidimas panaikintas (reikalingas
// perleidimas / iškėlimas)“ ir jo taisyklės taikomi tik leidimams, panaikintiems po įdiegimo.
describe('permit revocation status (integration)', () => {
  let broker: ServiceBroker;
  let activeId: number;
  let revokedId: number;
  let earlierRevokedId: number;
  let tenantRevokedId: number;

  const relocationRequiredOf = async (id: number) =>
    (await knex('permits').where({ id }).first('relocationRequired')).relocationRequired;

  const listAs = async (meta: object, action = 'permits.list') => {
    const result: { rows: PermitRow[] } | PermitRow[] = await broker.call(
      action,
      { pageSize: 100 },
      { meta },
    );
    return Array.isArray(result) ? result : result.rows;
  };

  beforeAll(async () => {
    await resetDomainTables();
    broker = await createTestBroker();

    activeId = await createPermitFixture({ permitNumber: 'REV-ACTIVE', users: [HOLDER] });
    revokedId = await createPermitFixture({ permitNumber: 'REV-NEW', users: [HOLDER] });
    earlierRevokedId = await createPermitFixture({ permitNumber: 'REV-OLD', users: [HOLDER] });
    tenantRevokedId = await createPermitFixture({ permitNumber: 'REV-TENANT', tenant: TENANT });

    // Leidimas, panaikintas iki šio pakeitimo: turi tik panaikinimo datą.
    await knex('permits')
      .where({ id: earlierRevokedId })
      .update({ deletedAt: new Date('2026-01-15T10:00:00Z') });

    for (const id of [revokedId, tenantRevokedId]) {
      await broker.call(
        'permits.removePermit',
        { id, deleteReason: 'REQUESTED_CANCELLATION' },
        { meta: deletingAdminMeta() },
      );
    }
  });

  afterAll(async () => {
    await broker.stop();
    await knex.destroy();
  });

  it('marks a permit revoked from now on and leaves earlier revoked permits as they were', async () => {
    expect(await relocationRequiredOf(revokedId)).toBe(true);
    expect(await relocationRequiredOf(earlierRevokedId)).toBe(false);
    expect(await relocationRequiredOf(activeId)).toBe(false);
  });

  it('shows the status to an admin in the list of revoked permits', async () => {
    const deleted = await listAs(adminMeta(), 'permits.listDeleted');

    expect(statusById(deleted)).toEqual({
      [revokedId]: PermitStatus.RELOCATION_REQUIRED,
      [tenantRevokedId]: PermitStatus.RELOCATION_REQUIRED,
      [earlierRevokedId]: PermitStatus.REVOKED,
    });
  });

  it('keeps revoked permits out of the admin list of active permits', async () => {
    expect(statusById(await listAs(adminMeta()))).toEqual({ [activeId]: PermitStatus.ACTIVE });
  });

  it('lets the holder see the permit with its status, but not a permit revoked earlier', async () => {
    const expected = {
      [activeId]: PermitStatus.ACTIVE,
      [revokedId]: PermitStatus.RELOCATION_REQUIRED,
    };

    expect(statusById(await listAs(userMeta({ userId: HOLDER })))).toEqual(expected);
    expect(statusById(await listAs(userMeta({ userId: HOLDER }), 'permits.find'))).toEqual(
      expected,
    );
    expect(await broker.call('permits.count', {}, { meta: userMeta({ userId: HOLDER }) })).toBe(2);
  });

  it('lets the holder open the revoked permit, but not a permit revoked earlier', async () => {
    const get = (id: number) =>
      broker.call('permits.get', { id }, { meta: userMeta({ userId: HOLDER }) });

    await expect(get(revokedId)).resolves.toMatchObject({
      id: revokedId,
      status: PermitStatus.RELOCATION_REQUIRED,
    });
    await expect(get(earlierRevokedId)).rejects.toMatchObject({ code: 404 });
  });

  it('shows a company its revoked permit under the company profile', async () => {
    const permits = await listAs(userMeta({ userId: TENANT_MEMBER, profile: TENANT }));

    expect(statusById(permits)).toEqual({ [tenantRevokedId]: PermitStatus.RELOCATION_REQUIRED });
  });

  it('shows nothing to a user who holds none of the permits', async () => {
    expect(await listAs(userMeta({ userId: STRANGER }))).toEqual([]);
    await expect(
      broker.call('permits.get', { id: revokedId }, { meta: userMeta({ userId: STRANGER }) }),
    ).rejects.toMatchObject({ code: 404 });
  });

  it('does not let the holder change the revoked permit', async () => {
    await expect(
      broker.call(
        'permits.createOrUpdate',
        { id: revokedId, fencedArea: 12 },
        { meta: userMeta({ userId: HOLDER }) },
      ),
    ).rejects.toMatchObject({ code: 404 });

    expect((await knex('permits').where({ id: revokedId }).first('fencedArea')).fencedArea).toBe(
      null,
    );
  });

  it('does not let a client set the mark or the status', async () => {
    await broker.call(
      'permits.createOrUpdate',
      { id: activeId, relocationRequired: true, status: PermitStatus.RELOCATION_REQUIRED },
      { meta: adminMeta() },
    );

    expect(await relocationRequiredOf(activeId)).toBe(false);
  });

  it('keeps the revoked permit out of the public counts of zoos', async () => {
    const general: { zoosCount: number } = await broker.call('permits.generalStatistic');

    expect(general.zoosCount).toBe(1);
  });

  describe('after the revocation is undone', () => {
    beforeAll(async () => {
      await broker.call(
        'permits.restorePermit',
        { id: revokedId, reason: 'Klaidingai panaikintas' },
        { meta: deletingAdminMeta() },
      );
    });

    it('the permit is active again', async () => {
      expect(await relocationRequiredOf(revokedId)).toBe(false);
      expect(statusById(await listAs(userMeta({ userId: HOLDER })))).toEqual({
        [activeId]: PermitStatus.ACTIVE,
        [revokedId]: PermitStatus.ACTIVE,
      });
    });

    it('the status comes back when the permit is revoked again', async () => {
      await broker.call(
        'permits.removePermit',
        { id: revokedId, deleteReason: 'NON_COMPLIANCE' },
        { meta: deletingAdminMeta() },
      );

      expect(await relocationRequiredOf(revokedId)).toBe(true);
    });
  });
});
