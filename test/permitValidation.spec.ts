import {
  isMunicipalityAccepted,
  isPermitIdentityChanged,
  isSpeciesAllowedByPermit,
  isValidMunicipality,
  normalizeClassifierName,
} from '../modules/permitValidation';

describe('permitValidation', () => {
  it('detects permit identity changes and ignores time of day', () => {
    const current = { permitNumber: 'A-1', issuer: 1, issueDate: new Date('2026-01-01T00:00:00Z') };

    expect(
      isPermitIdentityChanged(current, { ...current, issueDate: '2026-01-01T00:00:00.000Z' }),
    ).toBe(false);
    expect(isPermitIdentityChanged(current, { ...current, issuer: '1' as any })).toBe(false);
    expect(isPermitIdentityChanged(current, { ...current, permitNumber: 'A-2' })).toBe(true);
    expect(isPermitIdentityChanged(current, { ...current, issueDate: '2026-01-02' })).toBe(true);
  });

  it('compares issue dates by the Vilnius day', () => {
    const current = { permitNumber: 'A-1', issuer: 1, issueDate: '2026-01-01T22:00:00.000Z' };

    // 2026-01-01T22:00Z yra sausio 2 d. Vilniuje.
    expect(isPermitIdentityChanged(current, { ...current, issueDate: '2026-01-02' })).toBe(false);
    expect(
      isPermitIdentityChanged(
        { ...current, issueDate: '2026-01-01T23:30:00.000Z' },
        { ...current, issueDate: '2026-01-01T10:00:00.000Z' },
      ),
    ).toBe(true);
  });

  it('keeps an unchanged legacy municipality but rejects a new malformed one', () => {
    expect(isMunicipalityAccepted({}, {})).toBe(true);
    expect(isMunicipalityAccepted({}, undefined)).toBe(false);
    expect(isMunicipalityAccepted({ id: 1 }, { id: 2 })).toBe(false);
    expect(isMunicipalityAccepted(null, undefined)).toBe(true);
  });

  it('accepts only municipalities with an id and a name', () => {
    expect(isValidMunicipality({ id: 13, name: 'Vilniaus m. sav.' })).toBe(true);
    expect(isValidMunicipality({ id: '13', name: 'Vilniaus m. sav.' })).toBe(true);
    expect(isValidMunicipality({ id: 13 })).toBe(false);
    expect(isValidMunicipality({ id: 'abc', name: 'X' })).toBe(false);
    expect(isValidMunicipality('Vilnius')).toBe(false);
    expect(isValidMunicipality([{ id: 1, name: 'X' }])).toBe(false);
  });

  it('allows a species listed by id or by its whole family', () => {
    const rows = [{ species: 10, family: 1 }, { family: 2 }];

    expect(isSpeciesAllowedByPermit(rows, 10, 1)).toBe(true);
    expect(isSpeciesAllowedByPermit(rows, 11, 1)).toBe(false);
    expect(isSpeciesAllowedByPermit(rows, 20, 2)).toBe(true);
    expect(isSpeciesAllowedByPermit(rows, 20, undefined)).toBe(false);
  });

  it('normalizes classifier names for comparison', () => {
    expect(normalizeClassifierName('  Dama   DAMA ')).toBe('dama dama');
    expect(normalizeClassifierName(undefined)).toBe('');
  });
});
