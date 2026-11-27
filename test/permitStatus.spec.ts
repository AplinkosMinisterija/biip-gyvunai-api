'use strict';

import { isPermitRevoked, permitStatus, PermitStatus } from '../modules/permitStatus';

describe('permit status', () => {
  it('is active while the permit is not deleted', () => {
    expect(permitStatus({ deletedAt: null, relocationRequired: false })).toBe(PermitStatus.ACTIVE);
    expect(permitStatus({})).toBe(PermitStatus.ACTIVE);
  });

  it('asks for relocation when the permit was revoked under the new rules', () => {
    expect(permitStatus({ deletedAt: new Date(), relocationRequired: true })).toBe(
      PermitStatus.RELOCATION_REQUIRED,
    );
  });

  it('stays plainly revoked for a permit revoked before the new rules', () => {
    expect(permitStatus({ deletedAt: '2026-01-15', relocationRequired: false })).toBe(
      PermitStatus.REVOKED,
    );
    expect(permitStatus({ deletedAt: new Date() })).toBe(PermitStatus.REVOKED);
  });

  // Žyma be panaikinimo datos nieko nereiškia: atstatytas leidimas vėl galioja.
  it('ignores the relocation mark of a permit that is not deleted', () => {
    expect(permitStatus({ deletedAt: null, relocationRequired: true })).toBe(PermitStatus.ACTIVE);
  });

  it('treats both revoked statuses as revoked and a missing permit as not revoked', () => {
    expect(isPermitRevoked({ status: PermitStatus.RELOCATION_REQUIRED })).toBe(true);
    expect(isPermitRevoked({ status: PermitStatus.REVOKED })).toBe(true);
    expect(isPermitRevoked({ status: PermitStatus.ACTIVE })).toBe(false);
    expect(isPermitRevoked(null)).toBe(false);
    expect(isPermitRevoked(undefined)).toBe(false);
    expect(isPermitRevoked({})).toBe(false);
  });
});
