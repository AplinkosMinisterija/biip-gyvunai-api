import { isEqual, isPlainObject } from 'lodash';
import moment from 'moment-timezone';

const TIMEZONE = 'Europe/Vilnius';

export type PermitIdentity = {
  id?: number;
  issueDate: Date | string;
  issuer: number;
  permitNumber: string;
};

type PermitSpeciesRow = { species?: number | null; family?: number | null };

// Diena Vilniaus laiku, kaip ir unikalumo užklausoje (`formatDateFrom`/`formatDateTo`).
const toDay = (date?: Date | string) => {
  if (!date) return undefined;
  const parsed = moment.utc(date);
  return parsed.isValid() ? parsed.tz(TIMEZONE).format('YYYY-MM-DD') : String(date);
};

export const isPermitIdentityChanged = (current: PermitIdentity, updated: PermitIdentity) =>
  String(current.permitNumber) !== String(updated.permitNumber) ||
  Number(current.issuer) !== Number(updated.issuer) ||
  toDay(current.issueDate) !== toDay(updated.issueDate);

// Savivaldybė saugoma kaip { id, name } iš `locations.getMunicipalities`.
export const isValidMunicipality = (value: unknown) => {
  if (!isPlainObject(value)) return false;

  const { id, name } = value as { id?: unknown; name?: unknown };
  const hasId = (typeof id === 'number' || typeof id === 'string') && Number.isFinite(Number(id));
  const hasName = typeof name === 'string' && name.trim().length > 0;

  return hasId && hasName;
};

// Nepakeista sena reikšmė praleidžiama, kad leidimai su netvarkinga savivaldybe liktų redaguojami.
export const isMunicipalityAccepted = (value: unknown, stored?: unknown) =>
  value === null || isValidMunicipality(value) || (stored !== undefined && isEqual(value, stored));

// Leidimo eilutė be rūšies leidžia visą šeimą; su rūšimi — tik tą rūšį.
export const isSpeciesAllowedByPermit = (
  permitSpecies: PermitSpeciesRow[],
  speciesClassifierId: number,
  familyId?: number,
) =>
  permitSpecies.some((row) =>
    row.species
      ? Number(row.species) === Number(speciesClassifierId)
      : !!familyId && Number(row.family) === Number(familyId),
  );

export const normalizeClassifierName = (value?: string) =>
  (value || '').replace(/\s+/g, ' ').trim().toLowerCase();

// SQL atitikmuo `normalizeClassifierName`. PostgreSQL `[[:space:]]` neapima kai kurių tarpų,
// kuriuos JS `\s` laiko tarpais (chr(160), chr(8199), chr(8239), chr(65279)), todėl jie
// pridedami atskirai. Ta pati išraiška yra unikaliame indekse (migracija 20261026120100),
// todėl abi lyginamos pusės normalizuojamos SQL'e.
// Argumentas — stulpelio pavadinimas arba `?`, ne naudotojo tekstas.
export const normalizedSql = (expression: 'name' | 'name_latin' | '?') =>
  `lower(btrim(regexp_replace(${expression}, '[[:space:]' || chr(160) || chr(8199) || chr(8239) || chr(65279) || ']+', ' ', 'g')))`;
