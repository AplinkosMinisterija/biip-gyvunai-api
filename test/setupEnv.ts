// Leidžia paleisti `npx jest` tiesiogiai — Windows'e `yarn test` skripto `export` neveikia,
// o testams visada reikia atskiros testinės DB (5331), ne dev DB iš .env.
process.env.DB_CONNECTION ??= 'postgresql://postgres:postgres@localhost:5331/gyvunai';

// minio serviso schema testuose tik kuriama (ne startuojama) — klientui užtenka bet kokių reikšmių.
process.env.MINIO_ENDPOINT ??= 'localhost';
process.env.MINIO_PORT ??= '9000';
process.env.MINIO_ACCESSKEY ??= 'test';
process.env.MINIO_SECRETKEY ??= 'test';
