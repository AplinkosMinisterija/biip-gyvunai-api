// Leidžia paleisti `npx jest` tiesiogiai — Windows'e `yarn test` skripto `export` neveikia,
// o testams visada reikia atskiros testinės DB (5331), ne dev DB iš .env.
process.env.DB_CONNECTION ??= 'postgresql://postgres:postgres@localhost:5331/gyvunai';
