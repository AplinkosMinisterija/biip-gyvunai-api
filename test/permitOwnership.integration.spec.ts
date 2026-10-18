'use strict';

import { ServiceBroker } from 'moleculer';
import { AddressInfo } from 'net';
import path from 'path';
import {
  createPermitFixture,
  createTestBroker,
  knex,
  resetDomainTables,
} from './helpers/testBroker';

// Užklausos siunčiamos per tikrą API gateway (HTTP), nes spragos buvo REST lygyje:
// `PATCH /permits/:id`, `?scope=` ir `GET /permits/deleted`.
process.env.PORT = '0';

type AuthUser = { id: number; type: 'USER' | 'ADMIN'; firstName: string; lastName: string };

const AUTH_USERS: Record<string, AuthUser> = {
  holder: { id: 990001, type: 'USER', firstName: 'Testas', lastName: 'Turėtojas' },
  stranger: { id: 990002, type: 'USER', firstName: 'Testas', lastName: 'Pašalinis' },
  admin: { id: 990003, type: 'ADMIN', firstName: 'Testas', lastName: 'Administratorius' },
};

const insertId = (row: any) => Number(typeof row === 'object' ? row.id : row);

describe('permit ownership over HTTP (integration)', () => {
  let broker: ServiceBroker;
  let baseUrl: string;
  const localUserId: Record<string, number> = {};
  let holderTenant: number;
  let strangerTenant: number;
  let familyId: number;
  let classifierId: number;

  const request = async (
    method: string,
    url: string,
    token: keyof typeof AUTH_USERS,
    body?: unknown,
    profile?: number,
  ) => {
    const response = await fetch(`${baseUrl}/gyvunai/api${url}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(profile ? { 'x-profile': String(profile) } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };

  const permitRow = (id: number) => knex('permits').where({ id }).first();

  beforeAll(async () => {
    await resetDomainTables();
    broker = await createTestBroker();
    broker.createService({
      name: 'auth.users',
      actions: {
        resolveToken: {
          visibility: 'public',
          handler: (ctx) => AUTH_USERS[(ctx.meta as { authToken: string }).authToken],
        },
      },
    });
    const api = broker.loadService(path.join(__dirname, '../services/api.service.ts'));
    await broker.waitForServices(['api', 'auth.users']);
    const { port } = (api as any).server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;

    for (const [key, authUser] of Object.entries(AUTH_USERS)) {
      const user: { id: number } = await broker.call('users.findOrCreate', { authUser });
      localUserId[key] = user.id;
    }

    const tenants = await knex('tenants')
      .insert([
        { name: 'Testinė turėtojo įmonė', createdAt: new Date() },
        { name: 'Testinė pašalinė įmonė', createdAt: new Date() },
      ])
      .returning('id');
    [holderTenant, strangerTenant] = tenants.map(insertId);
    await knex('tenantUsers').insert([
      { tenantId: holderTenant, userId: localUserId.holder, role: 'USER', createdAt: new Date() },
      {
        tenantId: strangerTenant,
        userId: localUserId.stranger,
        role: 'USER',
        createdAt: new Date(),
      },
    ]);

    const [family] = await knex('familyClassifiers')
      .insert({ name: 'Testiniai nuosavybės', nameLatin: 'Ownershipidae test' })
      .returning('id');
    familyId = insertId(family);
    const [classifier] = await knex('speciesClassifiers')
      .insert({
        name: 'Testinė nuosavybė',
        nameLatin: 'Ownership testa',
        familyClassifierId: familyId,
      })
      .returning('id');
    classifierId = insertId(classifier);
  });

  afterAll(async () => {
    await broker.stop();
    await knex('tenantUsers').whereIn('tenantId', [holderTenant, strangerTenant]).delete();
    await knex('tenants').whereIn('id', [holderTenant, strangerTenant]).delete();
    await knex('users').whereIn('id', Object.values(localUserId)).delete();
    await knex('speciesClassifiers').where({ id: classifierId }).delete();
    await knex('familyClassifiers').where({ id: familyId }).delete();
    await knex.destroy();
  });

  describe('PATCH /permits/:id', () => {
    let permitId: number;

    beforeEach(async () => {
      permitId = await createPermitFixture({
        permitNumber: `OWN-${Math.random().toString(36).slice(2, 8)}`,
        users: [localUserId.holder],
      });
      await knex('permitSpecies').insert({
        permitId,
        speciesClassifierId: classifierId,
        familyClassifierId: familyId,
        createdAt: new Date(),
      });
    });

    it('a stranger gets 404 and the permit stays unchanged', async () => {
      const before = await permitRow(permitId);

      const response = await request('PATCH', `/permits/${permitId}`, 'stranger', {
        permitNumber: 'HACKED-1',
        cadastralIds: ['4400-9999-0001'],
        users: `[${localUserId.stranger}]`,
        tenant: strangerTenant,
      });

      expect(response.status).toBe(404);
      expect(await permitRow(permitId)).toEqual(before);
    });

    it('a member of another tenant gets 404 with their own profile', async () => {
      const response = await request(
        'PATCH',
        `/permits/${permitId}`,
        'stranger',
        { fencingOffDate: '2026-05-05' },
        strangerTenant,
      );

      expect(response.status).toBe(404);
      expect((await permitRow(permitId)).fencingOffDate).toBeNull();
    });

    it('the holder can fill in fencing data but nothing else', async () => {
      const before = await permitRow(permitId);

      const response = await request('PATCH', `/permits/${permitId}`, 'holder', {
        fencingOffDate: '2026-05-05',
        fencingOffStartDate: '2026-04-01',
        fencedArea: 12,
        permitNumber: 'CHANGED-1',
        issuer: 2,
        users: `[${localUserId.stranger}]`,
        tenant: strangerTenant,
        permitSpecies: [],
      });

      expect(response.status).toBe(200);
      const after = await permitRow(permitId);
      expect(after.fencingOffDate).not.toBeNull();
      expect(after.fencingOffStartDate).not.toBeNull();
      expect(Number(after.fencedArea)).toBe(12);
      expect(after.permitNumber).toBe(before.permitNumber);
      expect(after.issuerId).toBe(before.issuerId);
      expect(after.users).toEqual([localUserId.holder]);
      expect(after.tenantId).toBeNull();

      const species = await knex('permitSpecies').where({ permitId }).whereNull('deletedAt');
      expect(species).toHaveLength(1);
    });

    it('the tenant holder can update its permit under the tenant profile', async () => {
      const tenantPermit = await createPermitFixture({
        permitNumber: `OWN-T-${Math.random().toString(36).slice(2, 8)}`,
        tenant: holderTenant,
      });

      const response = await request(
        'PATCH',
        `/permits/${tenantPermit}`,
        'holder',
        { fencingOffDate: '2026-06-06', tenant: strangerTenant },
        holderTenant,
      );

      expect(response.status).toBe(200);
      const after = await permitRow(tenantPermit);
      expect(after.fencingOffDate).not.toBeNull();
      expect(after.tenantId).toBe(holderTenant);
    });

    it('an admin can still change permit data', async () => {
      const response = await request('PATCH', `/permits/${permitId}`, 'admin', {
        permitNumber: 'ADMIN-CHANGED-1',
      });

      expect(response.status).toBe(200);
      expect((await permitRow(permitId)).permitNumber).toBe('ADMIN-CHANGED-1');
    });
  });

  describe('POST /permits', () => {
    it('a user cannot assign holders when creating a permit', async () => {
      const response = await request('POST', '/permits', 'stranger', {
        permitNumber: `OWN-NEW-${Math.random().toString(36).slice(2, 8)}`,
        issueDate: '2026-01-01',
        issuer: 1,
        type: 'ZOO',
        file: [{ url: 'https://example.test/leidimas.pdf', name: 'leidimas.pdf', size: 1 }],
        users: `[${localUserId.holder}]`,
        tenant: holderTenant,
      });

      expect(response.status).toBe(200);
      const created = await permitRow(response.body.id);
      expect(created.users).toBeNull();
      expect(created.tenantId).toBeNull();
    });
  });

  describe('deleted permits', () => {
    let deletedPermitId: number;

    beforeAll(async () => {
      deletedPermitId = await createPermitFixture({
        permitNumber: `OWN-DEL-${Math.random().toString(36).slice(2, 8)}`,
        users: [localUserId.holder],
      });
      await knex('permits').where({ id: deletedPermitId }).update({ deletedAt: new Date() });
    });

    it.each(['deleted', 'false', '-notDeleted'])(
      'a user cannot read deleted permits with scope=%s',
      async (scope) => {
        const list = await request('GET', `/permits?scope=${scope}&pageSize=100`, 'holder');
        expect(list.status).toBe(200);
        expect(list.body.rows.map((row: { id: number }) => row.id)).not.toContain(deletedPermitId);

        const single = await request('GET', `/permits/${deletedPermitId}?scope=${scope}`, 'holder');
        expect(single.status).toBe(404);
      },
    );

    it('a user cannot list deleted permits', async () => {
      const response = await request('GET', '/permits/deleted', 'holder');
      expect(response.status).toBe(401);
    });

    it('an admin can list deleted permits and read them with scope', async () => {
      const list = await request('GET', '/permits/deleted?pageSize=100', 'admin');
      expect(list.status).toBe(200);
      expect(list.body.rows.map((row: { id: number }) => row.id)).toContain(deletedPermitId);

      const single = await request('GET', `/permits/${deletedPermitId}?scope=deleted`, 'admin');
      expect(single.status).toBe(200);
    });
  });
});
