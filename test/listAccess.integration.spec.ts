'use strict';

import { ServiceBroker } from 'moleculer';
import { AddressInfo } from 'net';
import path from 'path';
import {
  activeClassifierIds,
  createPermitFixture,
  createTestBroker,
  knex,
  resetDomainTables,
} from './helpers/testBroker';

// Užklausos siunčiamos per tikrą API gateway (HTTP): tikrinama, kad sąrašo parametrai
// (`query`, `search`, `searchFields`) gali tik siaurinti tai, ką naudotojas ir taip mato.
process.env.PORT = '0';

type AuthUser = { id: number; type: 'USER' | 'ADMIN'; firstName: string; lastName: string };
type Role = 'holder' | 'stranger' | 'owner' | 'admin';

// `holder` ir `stranger` — skirtingų įmonių eiliniai nariai, `owner` — `holder` įmonės savininkas.
const AUTH_USERS: Record<Role, AuthUser> = {
  holder: { id: 990011, type: 'USER', firstName: 'Testas', lastName: 'Turėtojas' },
  stranger: { id: 990012, type: 'USER', firstName: 'Testas', lastName: 'Pašalinis' },
  owner: { id: 990014, type: 'USER', firstName: 'Testas', lastName: 'Savininkas' },
  admin: { id: 990013, type: 'ADMIN', firstName: 'Testas', lastName: 'Administratorius' },
};

type RequestOptions = { profile?: number; method?: string; body?: unknown };

const insertId = (row: any) => Number(typeof row === 'object' ? row.id : row);

const insert = async (table: string, row: Record<string, unknown>): Promise<number> => {
  const [created] = await knex(table)
    .insert({ createdAt: new Date(), ...row })
    .returning('id');
  return insertId(created);
};

const json = (value: unknown) => encodeURIComponent(JSON.stringify(value));

type Owned = { permit: number; species: number; animal: number; record: number };

describe('list parameters cannot widen access (integration)', () => {
  let broker: ServiceBroker;
  let baseUrl: string;
  const userId = {} as Record<Role, number>;
  const tenantId = {} as Record<'holder' | 'stranger', number>;
  const membershipId = {} as Record<'holder' | 'owner' | 'stranger', number>;
  const own = {} as Owned & { deletedPermit: number; deletedRecord: number; tenantPermit: number };
  const foreign = {} as Owned & { deletedPermit: number; tenantPermit: number };

  // `role: null` — užklausa be prisijungimo.
  const request = async (url: string, role: Role | null, options: number | RequestOptions = {}) => {
    const { profile, method, body }: RequestOptions =
      typeof options === 'number' ? { profile: options } : options;
    const response = await fetch(`${baseUrl}/gyvunai/api${url}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(role ? { Authorization: `Bearer ${role}` } : {}),
        ...(profile ? { 'x-profile': String(profile) } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, text };
  };

  // Sąrašo (`rows`) arba `find`/`all` (masyvas) atsakymo id.
  const idsOf = async (url: string, role: Role, profile?: number): Promise<number[]> => {
    const { status, body } = await request(url, role, profile);
    expect(status).toBe(200);
    return (body.rows ?? body).map((row: { id: number }) => row.id).sort();
  };

  beforeAll(async () => {
    await resetDomainTables();
    broker = await createTestBroker();
    broker.createService({
      name: 'auth.users',
      actions: {
        resolveToken: {
          visibility: 'public',
          handler: (ctx) => AUTH_USERS[(ctx.meta as { authToken: Role }).authToken],
        },
      },
    });
    const api = broker.loadService(path.join(__dirname, '../services/api.service.ts'));
    await broker.waitForServices(['api', 'auth.users']);
    const { port } = (api as any).server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;

    for (const role of Object.keys(AUTH_USERS) as Role[]) {
      const user: { id: number } = await broker.call('users.findOrCreate', {
        authUser: AUTH_USERS[role],
      });
      userId[role] = user.id;
    }

    for (const role of ['holder', 'stranger'] as const) {
      tenantId[role] = await insert('tenants', { name: `Sąrašų testo įmonė (${role})` });
    }
    for (const [role, company, memberRole] of [
      ['holder', 'holder', 'USER'],
      ['owner', 'holder', 'OWNER'],
      ['stranger', 'stranger', 'USER'],
    ] as const) {
      membershipId[role] = await insert('tenantUsers', {
        tenantId: tenantId[company],
        userId: userId[role],
        role: memberRole,
      });
      // Naudotojo įmonės saugomos ir `users.tenants` (pagal jį ieško `users.byTenant`).
      await knex('users')
        .where({ id: userId[role] })
        .update({ tenants: JSON.stringify({ [tenantId[company]]: memberRole }) });
    }

    const [classifierId] = await activeClassifierIds(1);
    for (const [role, target] of [
      ['holder', own],
      ['stranger', foreign],
    ] as const) {
      const tag = role.toUpperCase();
      target.permit = await createPermitFixture({
        permitNumber: `LIST-${tag}`,
        users: [userId[role]],
      });
      target.deletedPermit = await createPermitFixture({
        permitNumber: `LIST-${tag}-DELETED`,
        users: [userId[role]],
      });
      target.tenantPermit = await createPermitFixture({
        permitNumber: `LIST-${tag}-COMPANY`,
        tenant: tenantId[role],
      });
      await knex('permits')
        .where({ id: target.deletedPermit })
        .update({ deletedAt: new Date('2026-01-15T10:00:00Z') });
      await knex('permits')
        .where({ id: target.permit })
        .update({
          address: `Testo g. 1, ${tag}`,
          municipality: JSON.stringify({ id: 13, name: 'Vilniaus m. sav.' }),
        });

      target.species = await insert('species', {
        permitId: target.permit,
        speciesClassifierId: classifierId,
        possessionType: 'WITH_PERMIT',
        type: 'INDIVIDUAL',
        amount: 1,
        userId: userId[role],
      });
      target.animal = await insert('animals', {
        speciesId: target.species,
        permitId: target.permit,
        gender: 'MALE',
        userId: userId[role],
      });
      target.record = await insert('records', {
        animalId: target.animal,
        permitId: target.permit,
        type: 'VACCINATION',
        date: new Date(),
        note: `pastaba ${tag}`,
        userId: userId[role],
      });
    }
    own.deletedRecord = await insert('records', {
      animalId: own.animal,
      permitId: own.permit,
      type: 'OTHER',
      date: new Date(),
      userId: userId.holder,
      deletedAt: new Date('2026-01-15T10:00:00Z'),
    });
  });

  afterAll(async () => {
    await broker.stop();
    await resetDomainTables();
    await knex('tenantUsers').whereIn('tenantId', Object.values(tenantId)).delete();
    await knex('tenants').whereIn('id', Object.values(tenantId)).delete();
    await knex('users').whereIn('id', Object.values(userId)).delete();
    await knex.destroy();
  });

  describe('ownership', () => {
    const permitQueries = () => [
      `query=${json({ users: [] })}`,
      `query=${json({ users: { $exists: true } })}`,
      `query=${json({ users: [userId.stranger] })}`,
      'query[users][]=1',
      `query[users]=${userId.stranger}`,
      `query=${json({ $or: [{ users: { $exists: true } }, { id: { $gt: 0 } }] })}`,
      `query=${json({ $and: { users: [] } })}`,
    ];

    it('a permit query never returns permits of another holder', async () => {
      for (const query of permitQueries()) {
        for (const url of [`/permits?pageSize=100&${query}`, `/permits/all?${query}`]) {
          const ids = await idsOf(url, 'holder');
          expect([url, ids.filter((id) => id !== own.permit)]).toEqual([url, []]);
        }
      }
    });

    it('a permit query does not change the count', async () => {
      const count = await request(`/permits/count?query=${json({ users: [] })}`, 'holder');

      expect(count.body).toBe(1);
    });

    it('a query does not open a permit of another holder', async () => {
      for (const query of permitQueries()) {
        const response = await request(`/permits/${foreign.permit}?${query}`, 'holder');
        expect([query, response.status]).toEqual([query, 404]);
      }
    });

    it('a company profile cannot be swapped for another company in the query', async () => {
      const queries = [
        `query=${json({ tenant: tenantId.stranger })}`,
        `query=${json({ tenant: [] })}`,
      ];

      for (const query of queries) {
        const ids = await idsOf(`/permits?pageSize=100&${query}`, 'holder', tenantId.holder);
        expect([query, ids.filter((id) => id !== own.tenantPermit)]).toEqual([query, []]);
      }
    });

    it.each([
      ['species', 'species'],
      ['animals', 'animal'],
      ['records', 'record'],
    ] as const)('a %s query never returns rows of another user', async (resource, key) => {
      const queries = [
        `query[user]=${userId.stranger}`,
        'query[user][]=1',
        `query=${json({ user: { $exists: true } })}`,
        `query=${json({ user: userId.stranger })}`,
        `query=${json({ user: [] })}`,
      ];

      for (const query of queries) {
        const ids = await idsOf(`/${resource}?pageSize=100&${query}`, 'holder');
        expect([query, ids.filter((id) => id !== own[key])]).toEqual([query, []]);

        const single = await request(`/${resource}/${foreign[key]}?${query}`, 'holder');
        expect([query, single.status]).toEqual([query, 404]);
      }
    });

    // Anksčiau JSON eilute perduota užklausa ne administratoriui baigdavosi 500 klaida.
    it('a query sent as a JSON string still narrows the own list', async () => {
      expect(await idsOf(`/species?query=${json({ permit: own.permit })}`, 'holder')).toEqual([
        own.species,
      ]);
      expect(await idsOf(`/species?query=${json({ permit: foreign.permit })}`, 'holder')).toEqual(
        [],
      );
      expect(
        await idsOf(`/permits?filter=${json({ permitNumber: 'LIST-HOLDER' })}`, 'holder'),
      ).toEqual([own.permit]);
    });

    it('answers 422 to a query that is not valid JSON', async () => {
      const response = await request('/species?query=%7Bnot-json', 'holder');

      expect(response.status).toBe(422);
    });
  });

  describe('companies', () => {
    it('a user gets only the companies they belong to', async () => {
      for (const url of [
        '/tenants?pageSize=100',
        `/tenants?pageSize=100&query=${json({ id: tenantId.stranger })}`,
      ]) {
        const response = await request(url, 'holder');
        const ids: number[] = (response.body?.rows ?? []).map((row: { id: number }) => row.id);

        expect([url, response.status, ids.filter((id) => id !== tenantId.holder)]).toEqual([
          url,
          200,
          [],
        ]);
      }

      const single = await request(`/tenants/${tenantId.stranger}`, 'holder');
      expect(single.status).not.toBe(200);
    });
  });

  describe('deleted rows', () => {
    const deletedQueries = [
      `query=${json({ deletedAt: [] })}`,
      `query=${json({ deletedAt: [1] })}`,
      'query[deletedAt][]=1',
    ];

    it.each(deletedQueries)(
      'a holder cannot list or open a deleted permit with %s',
      async (query) => {
        expect(await idsOf(`/permits?pageSize=100&${query}`, 'holder')).toEqual([own.permit]);
        expect((await request(`/permits/count?${query}`, 'holder')).body).toBe(1);
        expect((await request(`/permits/${own.deletedPermit}?${query}`, 'holder')).status).toBe(
          404,
        );
      },
    );

    it.each(deletedQueries)('a holder cannot list a deleted record with %s', async (query) => {
      expect(await idsOf(`/records?pageSize=100&${query}`, 'holder')).toEqual([own.record]);
    });

    it('the admin list of active permits stays free of deleted ones', async () => {
      const ids = await idsOf(`/permits?pageSize=100&query=${json({ deletedAt: [] })}`, 'admin');

      expect(ids).not.toContain(own.deletedPermit);
      expect(ids).not.toContain(foreign.deletedPermit);
      expect(ids).toEqual(expect.arrayContaining([own.permit, foreign.permit]));
    });
  });

  describe('search', () => {
    const search = (text: string, fields: string) =>
      `search=${encodeURIComponent(text)}&searchFields=${fields}`;

    // Atitinka antrą paieškos lauką: jis negali būti prijungtas per ARBA prie visų kitų sąlygų.
    it('searching several fields returns only own permits', async () => {
      const query = search('LIST-', 'address,permitNumber');

      expect(await idsOf(`/permits?pageSize=100&${query}`, 'holder')).toEqual([own.permit]);
      expect(await idsOf(`/permits/all?${query}`, 'holder')).toEqual([own.permit]);
      expect((await request(`/permits/count?${query}`, 'holder')).body).toBe(1);
    });

    it('searching several fields returns only own records', async () => {
      const ids = await idsOf(`/records?pageSize=100&${search('pastaba', 'type,note')}`, 'holder');

      expect(ids).toEqual([own.record]);
    });

    it('the search still matches any of the given fields', async () => {
      // Atitinka tik antrą lauką (adresą).
      const byAddress = search('Testo g.', 'permitNumber,address');
      // Neatitinka nė vieno lauko.
      const nothing = search('nieko-tokio', 'permitNumber,address');

      expect(await idsOf(`/permits?pageSize=100&${byAddress}`, 'holder')).toEqual([own.permit]);
      expect(await idsOf(`/permits?pageSize=100&${nothing}`, 'holder')).toEqual([]);
    });

    it('an admin search covers all holders but not deleted permits', async () => {
      const ids = await idsOf(
        `/permits?pageSize=100&${search('LIST-', 'address,permitNumber')}`,
        'admin',
      );

      expect(ids).toEqual(
        [own.permit, own.tenantPermit, foreign.permit, foreign.tenantPermit].sort(),
      );
    });

    it('ignores search fields that are not columns of the table', async () => {
      const response = await request(
        `/permits?pageSize=100&${search('LIST-', 'permitNumber,noSuchField,status')}`,
        'holder',
      );

      expect(response.status).toBe(200);
      expect(response.body.rows.map((row: { id: number }) => row.id)).toEqual([own.permit]);
    });
  });

  describe('geometry filter', () => {
    const geometryFilter = (extra: string) =>
      `query=${json({
        geom: { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2], x: extra } },
      })}`;

    it('text inside a geometry filter never reaches the SQL', async () => {
      const queries = [
        geometryFilter("a' || chr(34) || '}')), 3346)) OR TRUE -- "),
        geometryFilter(
          "a' || chr(34) || '}')), 3346)) OR 1 = cast((select permit_number from permits limit 1) as int) -- ",
        ),
      ];

      for (const query of queries) {
        for (const url of [`/permits?pageSize=100&${query}`, `/permits/all?${query}`]) {
          const response = await request(url, 'holder');
          const rows: { id: number }[] = response.body.rows ?? response.body;

          expect([url, response.status]).toEqual([url, 200]);
          expect(rows.map(({ id }) => id)).toEqual([own.permit]);
        }
      }
    });
  });

  // JSON laukų sąlygas, rikiavimą pagal JSON savybę ir saugomą geometriją bibliotekos į SQL
  // įterpia kaip tekstą. Tekstas, galintis nutraukti SQL eilutę, turi būti atmestas, o ne įvykdytas:
  // įvykdytas `1/0` baigtųsi 500 klaida, o `OR TRUE` grąžintų svetimas eilutes.
  describe('text that ends up inside SQL', () => {
    const breakOut = (sql: string) => `x"}'::jsonb OR ${sql} OR 'a'='`;

    it('a JSON field condition with a quote is refused', async () => {
      const conditions = [
        { municipality: { name: breakOut('TRUE') } },
        { municipality: { name: { $in: ["x') OR TRUE OR ('a' = 'a"] } } },
        { municipality: { "x' OR TRUE OR 'a'='a": 1 } },
        { municipality: { name: 'x\\' } },
        { municipality: { name: 'a?b' } },
      ];
      // `$or` užklausoje — sąlygų sąrašas, filtre — objektas.
      const nested = { municipality: { name: breakOut('TRUE') } };
      const urls = [
        ...conditions.flatMap((condition) => [
          `query=${json(condition)}`,
          `filter=${json(condition)}`,
        ]),
        `query=${json({ $or: [nested] })}`,
        `query=${json({ $and: [{ $or: [nested] }] })}`,
        `filter=${json({ $or: nested })}`,
      ];

      for (const url of urls) {
        const response = await request(`/permits?pageSize=100&${url}`, 'holder');
        expect([url, response.status]).toEqual([url, 422]);
      }
    });

    it('a JSON field condition is refused on a public list too', async () => {
      const condition = { permits: { permitNumber: breakOut('(SELECT 1/0) = 1') } };
      const response = await request(
        `/public/permitsByCadastralIds?query=${json(condition)}`,
        null,
      );

      expect(response.status).toBe(422);
    });

    it('an ordinary JSON field condition still works', async () => {
      expect(
        await idsOf(`/permits?pageSize=100&query=${json({ municipality: { id: 13 } })}`, 'holder'),
      ).toEqual([own.permit]);
      expect(
        await idsOf(`/permits?pageSize=100&filter=${json({ municipality: { id: 14 } })}`, 'holder'),
      ).toEqual([]);
    });

    it('a sort field with anything but a plain path is ignored', async () => {
      const sort = encodeURIComponent("permits.a'||(SELECT 1/0)::text||'");

      for (const [url, role] of [
        [`/public/permitsByCadastralIds?query=%7B%7D&sort[]=${sort}`, null],
        [`/permits?pageSize=100&query=%7B%7D&sort[]=${sort}`, 'holder'],
        [`/permits?pageSize=100&query=%7B%7D&sort=${sort}`, 'admin'],
      ] as const) {
        const response = await request(url, role);
        expect([url, response.status]).toEqual([url, 200]);
      }
    });

    it('sorting by a plain field and by a JSON property still works', async () => {
      expect(await idsOf('/permits?pageSize=100&sort=-permitNumber', 'holder')).toEqual([
        own.permit,
      ]);
      expect(
        (await request('/permits?pageSize=100&query=%7B%7D&sort=municipality.name', 'admin'))
          .status,
      ).toBe(200);
    });

    it('a geometry with a quote in its text is refused when a permit is saved', async () => {
      const geom = (text: string) => ({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [500000, 6000000],
              crs: { type: 'name', properties: { name: text } },
            },
          },
        ],
      });
      const hostile = "x'||(SELECT 1/0)::text||'";
      const permitsBefore = await knex('permits').count('id as n').first();

      const created = await request('/permits', 'holder', {
        method: 'POST',
        body: {
          permitNumber: 'LIST-GEOM',
          issueDate: '2026-02-02',
          issuer: 1,
          type: 'ZOO',
          file: [{ url: 'https://example.test/x.pdf', name: 'x.pdf', size: 1 }],
          geom: geom(hostile),
        },
      });
      const updated = await request(`/permits/${own.permit}`, 'admin', {
        method: 'PATCH',
        body: { geom: geom(hostile) },
      });
      const updatedAsText = await request(`/permits/${own.permit}`, 'admin', {
        method: 'PATCH',
        body: { geom: `{"type":"Point","coordinates":[1,2],"x":"${hostile}"` },
      });

      expect([created.status, updated.status, updatedAsText.status]).toEqual([422, 422, 422]);
      expect(await knex('permits').count('id as n').first()).toEqual(permitsBefore);
    });

    it('an ordinary geometry is still saved', async () => {
      const response = await request(`/permits/${own.permit}`, 'admin', {
        method: 'PATCH',
        body: {
          geom: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [582000, 6061000] },
              },
            ],
          },
        },
      });
      const { rows } = await knex.raw('SELECT ST_AsText(geom) AS geom FROM permits WHERE id = ?', [
        own.permit,
      ]);
      const [saved] = rows;

      expect(response.status).toBe(200);
      expect(saved.geom).toBe('POINT(582000 6061000)');
    });
  });

  describe('company members', () => {
    it('only a member acting for the company can list its members', async () => {
      const url = (tenant: number) => `/users/byTenant/${tenant}?pageSize=100`;

      const own = await request(url(tenantId.holder), 'holder', tenantId.holder);
      expect(own.status).toBe(200);
      expect(own.body.rows.map((row: { id: number }) => row.id).sort()).toEqual(
        [userId.holder, userId.owner].sort(),
      );

      for (const [tenant, role, profile] of [
        [tenantId.stranger, 'holder', undefined],
        [tenantId.stranger, 'holder', tenantId.holder],
        [tenantId.holder, 'holder', undefined],
        [tenantId.holder, 'stranger', tenantId.stranger],
      ] as const) {
        const response = await request(url(tenant), role, profile);
        expect([tenant, role, profile, response.status]).toEqual([tenant, role, profile, 401]);
      }

      expect((await request(url(tenantId.stranger), 'admin')).status).toBe(200);
    });

    it('the member search cannot reach members of another company', async () => {
      const response = await request(
        `/users/byTenant/${tenantId.holder}?pageSize=100&search=Testas&searchFields=lastName,firstName`,
        'holder',
        tenantId.holder,
      );

      expect(response.status).toBe(200);
      expect(response.body.rows.map((row: { id: number }) => row.id).sort()).toEqual(
        [userId.holder, userId.owner].sort(),
      );
    });

    it('a membership of another company cannot be changed or removed', async () => {
      const roleOf = async (id: number) =>
        (await knex('tenantUsers').where({ id }).first('role', 'deletedAt')) ?? null;
      const before = await roleOf(membershipId.stranger);

      for (const [role, profile] of [
        ['holder', undefined],
        ['holder', tenantId.holder],
        ['owner', tenantId.holder],
      ] as const) {
        const patched = await request(`/tenantUsers/${membershipId.stranger}`, role, {
          profile,
          method: 'PATCH',
          body: { role: 'OWNER' },
        });
        const removed = await request(`/tenantUsers/${membershipId.stranger}`, role, {
          profile,
          method: 'DELETE',
        });
        expect([role, profile, patched.status, removed.status]).toEqual([role, profile, 404, 404]);
      }

      expect(await roleOf(membershipId.stranger)).toEqual(before);
    });

    it('an ordinary member cannot change memberships of the own company', async () => {
      const response = await request(`/tenantUsers/${membershipId.holder}`, 'holder', {
        profile: tenantId.holder,
        method: 'PATCH',
        body: { role: 'OWNER' },
      });

      expect(response.status).toBe(404);
      expect(
        (await knex('tenantUsers').where({ id: membershipId.holder }).first('role')).role,
      ).toBe('USER');
    });

    it('the owner can change a membership of the own company', async () => {
      const response = await request(`/tenantUsers/${membershipId.holder}`, 'owner', {
        profile: tenantId.holder,
        method: 'PATCH',
        body: { role: 'USER_ADMIN' },
      });

      expect(response.status).toBe(200);
      expect(
        (await knex('tenantUsers').where({ id: membershipId.holder }).first('role')).role,
      ).toBe('USER_ADMIN');
      await knex('tenantUsers').where({ id: membershipId.holder }).update({ role: 'USER' });
    });

    it('a member can still update the own profile', async () => {
      const response = await request('/users/me', 'holder', {
        method: 'PATCH',
        body: { phone: '+37060000000' },
      });

      expect(response.status).toBe(200);
    });

    it('an owner cannot invite a user into another company', async () => {
      const response = await request('/tenantUsers/invite', 'owner', {
        profile: tenantId.holder,
        method: 'POST',
        body: {
          firstName: 'Testas',
          lastName: 'Kviečiamas',
          personalCode: '39001010000',
          role: 'USER',
          tenant: tenantId.stranger,
        },
      });

      expect(response.status).toBe(401);
    });

    // Naudotojų administratorius negali pats tapti savininku, jo pašalinti ar pakviesti naujo.
    describe('a user administrator', () => {
      const membership = (id: number) =>
        knex('tenantUsers').where({ id }).first('role', 'deletedAt');
      const asUserAdmin = (url: string, method: string, body?: unknown) =>
        request(url, 'holder', { profile: tenantId.holder, method, body });

      beforeAll(() =>
        knex('tenantUsers').where({ id: membershipId.holder }).update({ role: 'USER_ADMIN' }),
      );
      afterAll(() =>
        knex('tenantUsers').where({ id: membershipId.holder }).update({ role: 'USER' }),
      );

      it('cannot make themselves the owner', async () => {
        const response = await asUserAdmin(`/tenantUsers/${membershipId.holder}`, 'PATCH', {
          role: 'OWNER',
        });

        expect(response.status).toBe(401);
        expect((await membership(membershipId.holder)).role).toBe('USER_ADMIN');
      });

      it('cannot change or remove the owner', async () => {
        const patched = await asUserAdmin(`/tenantUsers/${membershipId.owner}`, 'PATCH', {
          role: 'USER',
        });
        const removed = await asUserAdmin(`/tenantUsers/${membershipId.owner}`, 'DELETE');

        expect([patched.status, removed.status]).toEqual([401, 401]);
        expect(await membership(membershipId.owner)).toMatchObject({
          role: 'OWNER',
          deletedAt: null,
        });
      });

      it('cannot invite a new owner', async () => {
        const response = await asUserAdmin('/tenantUsers/invite', 'POST', {
          firstName: 'Testas',
          lastName: 'Kviečiamas',
          personalCode: '39001010000',
          role: 'OWNER',
          tenant: tenantId.holder,
        });

        expect(response.status).toBe(401);
      });
    });
  });

  describe('own profile', () => {
    const userRow = (id: number) =>
      knex('users').where({ id }).first('email', 'type', 'authUserId');

    it('changes only the contacts of the caller', async () => {
      const strangerBefore = await userRow(userId.stranger);
      const holderBefore = await userRow(userId.holder);

      const response = await request('/users/me', 'holder', {
        method: 'PATCH',
        body: {
          id: userId.stranger,
          email: 'naujas@example.test',
          type: 'ADMIN',
          authUser: AUTH_USERS.stranger.id,
        },
      });

      expect(response.status).toBe(200);
      expect(await userRow(userId.stranger)).toEqual(strangerBefore);
      expect(await userRow(userId.holder)).toEqual({
        ...holderBefore,
        email: 'naujas@example.test',
      });
    });

    it('does not open the list of all users', async () => {
      const response = await request('/users/all', 'holder');

      expect(response.status).toBe(401);
    });
  });

  describe('server errors', () => {
    it('do not show the failed SQL to the client', async () => {
      const response = await request(`/permits?query=${json({ noSuchColumn: 1 })}`, 'holder');

      expect(response.status).toBe(500);
      expect(response.text).not.toMatch(/select|permits|no_such_column|noSuchColumn/i);
    });

    it('keep the message of an ordinary client error', async () => {
      const response = await request(`/permits/${foreign.permit}`, 'holder');

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ type: 'ENTITY_NOT_FOUND' });
    });
  });
});
