import Knex from 'knex';
import { ServiceBroker } from 'moleculer';
import path from 'path';
import knexConfig from '../../knexfile';
import { AuthUserRole, UserAuthMeta } from '../../services/api.service';

// Realūs servisai, kurių elgseną tikrina integraciniai testai. Išoriniai (auth, mail, minio)
// pakeičiami stub'ais, kad testai nepriklausytų nuo tinklo.
const REAL_SERVICES = [
  'species',
  'records',
  'animals',
  'permits',
  'permits.species',
  'permits.histories',
  'speciesClassifiers',
  'markingTypeClassifiers',
  'issuerClassifiers',
  'users',
  'tenants',
  'tenantUsers',
  'fosteredAnimals',
];

const DOMAIN_TABLES = [
  'records',
  'animals',
  'species',
  'permit_species',
  'permit_histories',
  'permits',
];

export const knex = Knex(knexConfig);

export const createTestBroker = async (): Promise<ServiceBroker> => {
  const broker = new ServiceBroker({
    logger: false,
    transporter: null,
    cacher: null,
    metrics: false,
    tracing: false,
  });

  for (const name of REAL_SERVICES) {
    broker.loadService(path.join(__dirname, `../../services/${name}.service.ts`));
  }

  broker.createService({ name: 'auth', actions: { getSeedData: () => [] } });
  broker.createService({ name: 'mail', actions: { sendRecordEmail: () => true } });
  broker.createService({ name: 'minio', actions: { uploadFile: () => ({}) } });

  await broker.start();
  return broker;
};

export const resetDomainTables = async (): Promise<void> => {
  await knex.raw(`TRUNCATE ${DOMAIN_TABLES.join(', ')} RESTART IDENTITY`);
};

type MetaOptions = { userId: number; profile?: number };

export const adminMeta = (): Partial<UserAuthMeta> => ({
  authUser: { type: AuthUserRole.ADMIN, id: 1 },
  user: { id: 1 } as UserAuthMeta['user'],
});

export const userMeta = ({ userId, profile }: MetaOptions): Partial<UserAuthMeta> => ({
  authUser: { type: AuthUserRole.USER, id: userId },
  user: { id: userId } as UserAuthMeta['user'],
  ...(profile ? { profile } : {}),
});

type PermitFixture = { permitNumber: string; users?: number[]; tenant?: number };

// Leidimas kuriamas tiesiai per knex: `users` yra jsonb, o API laukas be `type: 'array'`
// masyvo į JSON nepaverčia, todėl per `permits.create` toks įrašas neįsirašo.
export const createPermitFixture = async ({
  permitNumber,
  users,
  tenant,
}: PermitFixture): Promise<number> => {
  const [row] = await knex('permits')
    .insert({
      permitNumber,
      issueDate: new Date('2026-01-01'),
      issuerId: 1,
      type: 'ZOO',
      users: users ? JSON.stringify(users) : null,
      tenantId: tenant ?? null,
      createdAt: new Date(),
    })
    .returning('id');

  return Number(typeof row === 'object' ? row.id : row);
};
