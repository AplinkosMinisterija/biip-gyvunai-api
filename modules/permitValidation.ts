import { isPlainObject } from 'lodash';

export type PermitIdentity = {
  id?: number;
  issueDate: Date | string;
  issuer: number;
  permitNumber: string;
};

type PermitSpeciesRow = { species?: number | null; family?: number | null };

const toDay = (date?: Date | string) => {
  if (!date) return undefined;
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? String(date) : parsed.toISOString().slice(0, 10);
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

// SQL atitikmuo `normalizeClassifierName` (stulpelio pavadinimas — tik iš kodo, ne iš naudotojo).
export const normalizedColumnSql = (column: 'name' | 'name_latin') =>
  `lower(btrim(regexp_replace(${column}, '\\s+', ' ', 'g')))`;
