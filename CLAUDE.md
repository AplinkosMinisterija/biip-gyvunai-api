# CLAUDE.md — biip-gyvunai-api

Compact reference for Claude Code (or any AI assistant) working in this repo. Read this before exploring.

## Purpose

Backend microservice for the Lithuanian Ministry of Environment (Aplinkos Ministerija) **Gyvūnai** registry — wild & non-traditional animal keeping. Manages permits, species, animals, life-event records, fostered animals, and tenant/user permissions.

- Repo: `AplinkosMinisterija/biip-gyvunai-api`
- Paired frontend: `AplinkosMinisterija/biip-gyvunai-web`
- Public HTTP base path: `/gyvunai/api/...`
- Architecture: Moleculer.js microservices, single broker, services exposed via API gateway

## Stack

| Component | Version | Notes |
|---|---|---|
| Moleculer | 0.14.29 | Service framework |
| TypeScript | 5.0 | Strict, decorators |
| Node | `>=18.0.0 <19.0.0` | LTS |
| Postgres + PostGIS | 14 | Spatial geometry |
| Knex | 2.4 | Migrations + queries (with snake_case mappers) |
| Objection.js | 3.0 | ORM (with @moleculer/database) |
| NATS | 2.13 | Event transporter (production) |
| Redis (ioredis) | 5.3 | Cacher (TTL 1h, prefix `gyvunai`) |
| MinIO | 7.1 | Object storage (images, PDFs) |
| Sentry | 7.68 | Error tracking |
| Postmark | 4.0 | Transactional emails (`noreply@biip.lt`) |
| Aplinkos Min. auth | `biip-auth-nodejs`, `@aplinkosministerija/moleculer-accounts` ^1.8 | External auth service integration |

### Pinned GitHub Dependencies (forks / non-npm)

```json
"@moleculer/database":      "github:ambrazasp/moleculerjs-database",
"biip-auth-nodejs":         "github:DadPatch/biip-auth-nodejs",
"moleculer-knex-filters":   "github:DadPatch/moleculer-knex-filters",
"moleculer-minio":          "github:dadpatch/moleculer-minio",
"moleculer-plantuml":       "github:DadPatch/moleculer-plantuml"
```

`moleculer-postgis` is the npm version (`^0.2.7`); a fork is being evaluated in PR #79 (geometry precision).

## Scripts

```bash
yarn dev              # ts-node hot-reload, runs migrations first
yarn start            # production: knex migrate:latest && moleculer-runner
yarn build            # tsc → dist/
yarn db:migrate       # knex migrate:latest
yarn test             # sets DB_CONNECTION to test DB on :5331, runs jest
yarn test:watch
yarn test:coverage
yarn lint             # eslint + prettier
yarn dc:up            # docker compose up (postgres + redis + minio)
yarn dc:down
yarn dc:logs
```

ESLint extends `@aplinkosministerija/eslint-config-biip-api`. Prettier uses `@aplinkosministerija/biip-prettier-config`. Husky + lint-staged on `*.{js,jsx,ts,tsx}`.

## Directory Layout

```
biip-gyvunai-api/
├── moleculer.config.ts        # broker: transporter, cacher, metrics, tracing
├── knexfile.ts                # pg connection + migration dir
├── jest.config.js
├── services/                  # ~23 *.service.ts files
├── mixins/                    # database.mixin, profile.mixin
├── modules/
│   └── geometry.ts            # PostGIS coord transforms (WGS84 ↔ LKS 3346)
├── database/
│   └── migrations/            # ~32 Knex migrations
├── types/                     # global TS types (constants, moleculer)
├── test/                      # Jest specs
├── Dockerfile
├── docker-compose.yml         # postgres :5633 / redis :5635 / minio :9050
└── .github/workflows/
```

## Services

| Service | File | Purpose |
|---|---|---|
| `api` | `api.service.ts` | HTTP gateway, auth/authz middleware, `/gyvunai/api/**` |
| `auth` | `auth.service.ts` | Token validation, login hooks, EVARTAI |
| `users` | `users.service.ts` | App-side user profiles (mirrors auth users) |
| `tenants` | `tenants.service.ts` | Organizations / farms |
| `tenantUsers` | `tenantUsers.service.ts` | User↔Tenant + role |
| `permits` | `permits.service.ts` | Permits + PostGIS geom + file upload |
| `permits.species` | `permits.species.service.ts` | Species linked to a permit |
| `permits.histories` | `permits.histories.service.ts` | Audit log for permit changes |
| `species` | `species.service.ts` | Master species catalog |
| `speciesClassifiers` | `speciesClassifiers.service.ts` | Species subtype enum |
| `familyClassifiers` | `familyClassifiers.service.ts` | Animal family enum |
| `markingTypeClassifiers` | `markingTypeClassifiers.service.ts` | Marking method enum |
| `issuerClassifiers` | `issuerClassifiers.service.ts` | Permit issuer enum |
| `animals` | `animals.service.ts` | Individual animals under permits |
| `records` | `records.service.ts` | Life-event records (birth/death/marking/sale/...); triggers emails |
| `fosteredAnimals` | `fosteredAnimals.service.ts` | Fostered animals (separate flow from permits) |
| `locations` | `locations.service.ts` | GIS lookups (municipality from point) — calls external GEO_SERVER |
| `minio` | `minio.service.ts` | File upload/download, presigned URLs |
| `mail` | `mail.service.ts` | Postmark wrapper, record-event notifications (Lithuanian copy) |
| `statistics` | `statistics.service.ts` | Aggregated reports |
| `public.permitSpecies` | `public.permitSpecies.service.ts` | Read-only public materialised view |
| `public.permitsByCadastralIds` | `public.permitsByCadastralIds.service.ts` | Public search by cadastral IDs |
| `sentry` | `sentry.service.ts` | Error reporting bridge |

## Service Pattern

All data services follow:

```ts
@Service({ name: 'animals', mixins: [DbConnection(), ProfileMixin] })
export default class AnimalsService extends moleculer.Service {
  // settings.fields define DB schema + populate + virtual fields
  // settings.scopes define named query filters
  // settings.defaultScopes auto-applied unless removed
  @Action()  list(ctx) { /* DbMixin provides list/find/get/create/update/remove */ }
  @Event()   'animals.created'(ctx, params) { /* event listener */ }
  @Method()  helper() { /* internal */ }
}
```

Decorators come from `moleculer-decorators`. CRUD is provided by the `@moleculer/database` mixin (wrapped via `mixins/database.mixin.ts`).

**Common conventions:**
- `populate: { action: 'permits.resolve' }` for relations (lazy-loaded, batched).
- Soft delete: every table has `deletedAt`, `deletedBy`. Default scope `notDeleted` filters them out; pass `scope: ['deleted']` (admin) to see deleted rows.
- DB columns are **snake_case**, service fields are **camelCase**, converted by `knexSnakeCaseMappers()`.

## ProfileMixin (`mixins/profile.mixin.ts`)

Auto-applies tenant/user filters in `beforeSelect`:

- `authUser.type` ∈ {ADMIN, SUPER_ADMIN} → no filter, sort `-createdAt`
- USER + `ctx.meta.profile` (tenant id) → filter `tenant: profile`
- USER + no profile → filter `user: userId` or JSONB `users @> [userId]`

## Auth Flow

1. Frontend sends `Authorization: Bearer <token>` (+ optional `x-profile: <tenantId>`).
2. `api.service.authenticate()` calls `auth.users.resolveToken` (via `biip-auth-nodejs`) → `authUser` object.
3. `resolveByAuthUser()` looks up or upserts the local `users` row.
4. `x-profile` (if numeric and user is a member) sets `ctx.meta.profile`.
5. `api.service.authorize()` checks `RestrictionType` against `authUser.type`:
   - `PUBLIC` — no auth needed
   - `USER` — must be USER
   - `ADMIN` — must be ADMIN/SUPER_ADMIN

Public endpoints: `auth.login`, `auth.refreshToken`, `auth.evartai.login`, `auth.evartai.sign`. Most CRUD defaults to ADMIN.

## REST Routing (`services/api.service.ts`)

```ts
settings: {
  port: 3000,
  path: '/gyvunai',
  routes: [{
    path: '/api',
    whitelist: ['**'],
    authentication: true,
    authorization: true,
    autoAliases: true,
    bodyParsers: { json: { limit: '1MB' } },
  }]
}
```

`autoAliases: true` exposes service actions as REST automatically:

```
GET    /gyvunai/api/animals         → animals.list
GET    /gyvunai/api/animals/:id     → animals.get
POST   /gyvunai/api/animals         → animals.create
PUT    /gyvunai/api/animals/:id     → animals.update
DELETE /gyvunai/api/animals/:id     → animals.remove
```

OpenAPI schema is generated by `moleculer-auto-openapi`.

## Files / MinIO

`services/minio.service.ts` exposes:
- `minio.upload(folder, name?, types?, isPrivate?, presign?)` — multipart, returns `{ url, name, size }`
- `minio.getUrl(objectName, isPrivate?, bucketName?)`

Allowed types: `IMAGE_TYPES` (png, jpeg) and `FILE_TYPES` (pdf). Bucket from `MINIO_BUCKET` (default `gyvunai`).

## GIS / PostGIS

- `permits.geom` stores polygon/multipolygon of fenced area; PostgisMixin (from `moleculer-postgis`) handles serialization to GeoJSON FeatureCollection.
- `modules/geometry.ts` does projection transforms via `transform-coordinates`: EPSG:4326 (WGS84) ↔ EPSG:3346 (Lithuanian LKS).
- `services/locations.service.ts` calls external `GEO_SERVER` for municipality lookups by point.

⚠️ **Open issue PR #79:** geometry precision is being lost on round-trip through PostGIS ↔ JSON. A fork of `moleculer-postgis` is proposed. Touch `permits.service.ts` geom handling carefully until that lands.

## Database

`knexfile.ts`:

```ts
client: 'pg',
connection: process.env.DB_CONNECTION,   // postgresql://user:pass@host:port/gyvunai
migrations: { directory: './database/migrations' },
pool: { min: 0, max: 10 },
...knexSnakeCaseMappers()
```

### Key Tables

| Table | Notable columns |
|---|---|
| `permits` | permit_number, issue_date, issuer_id, type (ZOO/AVIARY), address, municipality, forest, fencing_off_date, fencing_off_start_date, fenced_area, protected_territory, cadastral_ids[], building_ids[], tenant_id, users[], file, geom |
| `permit_histories` | permit_id, type, data (jsonb) — audit log |
| `species` | name, possession_type, iucn_risk, type, municipality_id |
| `species_classifiers` / `family_classifiers` / `marking_type_classifiers` / `issuer_classifiers` | reference enums |
| `animals` | permit_id, species_id, species_classifier_id, gender, birth_date, certificate, tenant_id, user_id, acquirement/birth/death/marking/sale_record |
| `records` | animal_id, permit_id, species_id, type, date, certificate_no, number_of_animals, marking_number, marking_date, death_reason |
| `tenants` | auth_group_id, name, email, phone, code |
| `tenant_users` | tenant_id, user_id, role |
| `users` | auth_user_id, first_name, last_name, email, phone, address, type |
| `fostered_animals` | speciesClassifier, gender, certificate, address, related records |
| `public_permit_species` (mat. view) | refresh on permit changes |
| `public_permits_by_cadastral_ids` (mat. view) | search by cadastral id |

### Recent Migrations (descending)

- `20252208122012_updateRecord.js`
- `20251907114021_updatePermit.js` — adds `fencingOffStartDate`
- `20250917112023_updatePermit.js`
- `20250821131012_createPermitHistories.js` — audit table
- `20250612112012_permitSpeciesViewUpdates.js`
- `20250606121212_publicPermitsByCadastralIdsView.js`
- `20250514125212_publicPermitSpeciesView.js`
- `20250507121231_update_permit.js`
- `20250205105325_buildingCadastralIds.js`
- `20250127124512_addOtherTypeToRecords.js` — adds `OTHER` record type

Naming: `YYYYMMDDhhmmss_descriptiveName.js`.

## External Integrations

### Postmark (mail)
`services/mail.service.ts` uses `new ServerClient(process.env.POSTMARK_KEY)`. Triggered on record events (sale, birth, death, marking, …) — recipients computed from auth permissions per municipality. Lithuanian email copy. Active only in production / staging.

### Aplinkos Min. Auth (`biip-auth-nodejs`)
Calls `process.env.AUTH_HOST` with `AUTH_API_KEY`. Provides `auth.users.resolveToken`, `auth.groups.get`, `auth.permissions.getUsersByAccess`.

### NATS Events
In production via `TRANSPORTER=nats://...`. Common publishes/subscribes: `animals.*`, `permits.*`, `species.*`, `permits.histories.*`. Use `@Event()` to subscribe.

## Moleculer Config (`moleculer.config.ts`)

| Setting | Value |
|---|---|
| transporter | null (local) or env-overridable to NATS |
| cacher | Redis (ioredis), TTL 1h, prefix `gyvunai` |
| serializer | JSON |
| requestTimeout | 10s |
| metrics | Prometheus on port 3030, `/metrics` |
| tracing | Event exporter (5s) + Console (dev only) |
| validation | enabled |

Moleculer env override convention: `MOL_CACHER__OPTIONS__PREFIX=...`.

## Environment Variables

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `production` enables Postmark sends |
| `PORT` | HTTP port (default 3000) |
| `DB_CONNECTION` | Postgres connection string |
| `AUTH_HOST` | External auth service URL |
| `AUTH_API_KEY` | Auth service API key |
| `APP_HOST` | Frontend base URL (for auth callbacks) |
| `ADMIN_HOST` | Admin panel URL |
| `MINIO_ENDPOINT` / `MINIO_PORT` / `MINIO_USESSL` | MinIO connection |
| `MINIO_ACCESSKEY` / `MINIO_SECRETKEY` | MinIO creds |
| `MINIO_BUCKET` | Bucket name (default `gyvunai`) |
| `REDIS_CONNECTION` | Redis URL (ioredis format) |
| `GEO_SERVER` | External GIS service URL |
| `POSTMARK_KEY` | Postmark API token |
| `SENTRY_DSN` | Sentry endpoint |
| `ENVIRONMENT`, `VERSION` | Deployment metadata |
| `TRANSPORTER` | Override Moleculer transporter (e.g. `nats://...`) |

## Testing

`jest.config.js` uses `ts-jest` preset, `testEnvironment: 'node'`, roots `./test`.

`yarn test` script explicitly sets `DB_CONNECTION=postgresql://postgres:postgres@localhost:5331/gyvunai` — there is a separate test DB on port **5331** (vs dev port **5633**). Make sure `dc:up` exposes it before running tests.

## Deployment

- **Dockerfile:** multi-stage Node 18; runs `knex migrate:latest && moleculer-runner` on start.
- **Healthcheck:** `wget http://localhost:3000/gyvunai/ping`.
- **docker-compose.yml** (local dev): `postgis/postgis:14-master` (5633), `redis` (5635), `minio` (9050 API + 9051 console).
- **GitHub Actions:**
  - `codeql.yml` — security scan
  - `deploy-staging.yml` — auto on `main`
  - `deploy-development.yml` — manual dispatch
  - `deploy-production.yml` — manual dispatch / release tag
  - Reusable workflows from `AplinkosMinisterija/reusable-workflows`

## Open PRs / Active Branches

- **#79** — `fix-geom-precision-loss` — switch to AM fork of `moleculer-postgis` (geometry precision regression)
- **#65** — `import-permit-users` — bulk-import users into permits
- **#38** — `left-joins` — refactor to LEFT JOINs to avoid N+1
- **#8** — Dependabot npm bumps

Recent topical work merged on `main` you may need context for: `add-marking-date-to-permit`, `add-marking-date-to-records`, `update-fencing-info`, `update-permit-users-tenants`, `createPermitHistories`. The active feature branch as of writing is `fix-set-user-to-animal`.

## Conventions / Gotchas

- **camelCase TS ↔ snake_case DB** — handled automatically by `knexSnakeCaseMappers()`. Don't fight it.
- **Soft deletes only** — never hard delete unless you know what you're doing.
- **Lithuanian strings inside `mail.service.ts`** for email subjects/bodies (Parduotas/Padovanotas, Gimė/išsirito, Nugaišo).
- **Custom error helpers** in shared utils: `throwNoRightsError` (401), `throwNotFoundError` (404), `throwBadRequestError` (400), `throwValidationError`.
- **Populates** are batched (`@moleculer/database` does it) but check N+1 if you add a custom resolver.
- **Materialized views** (`public.permitSpecies`, `public.permitsByCadastralIds`) need explicit refresh — done via event listeners on permit/species changes.
- **Pinned forks** (see Stack section) — `yarn install` will hit GitHub; failures usually mean a fork was renamed/moved.

## Quick Start

```bash
yarn install
cp .env.example .env       # set DB_CONNECTION, AUTH_HOST, AUTH_API_KEY, MINIO_*
yarn dc:up                 # postgres + redis + minio
yarn dev                   # migrates and starts hot-reload server

curl http://localhost:3000/gyvunai/ping
```

API endpoints land at `http://localhost:3000/gyvunai/api/...`. Metrics at `:3030/metrics`. MinIO console at `:9051`.
