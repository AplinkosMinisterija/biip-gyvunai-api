'use strict';

import { isLateEventDate, recordEventDate, resolveLateness } from '../modules/recordLateness';

describe('record lateness', () => {
  // 2026-11-23 10:00 Lietuvos laiku.
  const now = new Date('2026-11-23T08:00:00Z');

  it.each([
    ['2026-11-16', false],
    ['2026-11-16T21:59:00Z', false],
    ['2026-11-15T22:30:00Z', false],
    ['2026-11-15', true],
    ['2026-11-15T21:30:00Z', true],
    ['2025-01-01', true],
    ['2026-11-30', false],
  ])('event on %s is late: %s', (date, late) => {
    expect(isLateEventDate(date, now)).toBe(late);
  });

  it('counts Lithuanian calendar days, not 24 hour periods', () => {
    // Įvykis 2026-11-15 23:30, įvedama 2026-11-23 00:30 (Lietuvos laiku) — 8 dienos.
    expect(isLateEventDate('2026-11-15T21:30:00Z', new Date('2026-11-22T22:30:00Z'))).toBe(true);
    // Įvykis 2026-11-16 00:30, įvedama 2026-11-23 23:30 — 7 dienos.
    expect(isLateEventDate('2026-11-15T22:30:00Z', new Date('2026-11-23T21:30:00Z'))).toBe(false);
  });

  it('treats a missing or invalid date as on time', () => {
    expect(isLateEventDate(undefined, now)).toBe(false);
    expect(isLateEventDate('ne data', now)).toBe(false);
  });

  it('uses the marking date of a marking record', () => {
    expect(
      recordEventDate({ type: 'MARKING', date: '2020-01-01', markingDate: '2026-11-20' }),
    ).toBe('2026-11-20');
    expect(recordEventDate({ type: 'MARKING', date: '2020-01-01' })).toBe('2020-01-01');
    expect(recordEventDate({ type: 'DEATH', date: '2020-01-01', markingDate: '2026-11-20' })).toBe(
      '2020-01-01',
    );
  });

  it('requires a reason for a late record and drops it for a timely one', () => {
    expect(() => resolveLateness('2020-01-01')).toThrow(
      expect.objectContaining({ code: 422, type: 'LATE_REASON_REQUIRED' }),
    );
    expect(() => resolveLateness('2020-01-01', '   ')).toThrow(
      expect.objectContaining({ type: 'LATE_REASON_REQUIRED' }),
    );
    expect(resolveLateness('2020-01-01', ' Sužinota vėliau ')).toEqual({
      isLate: true,
      lateReason: 'Sužinota vėliau',
    });
    expect(resolveLateness(new Date(), 'nereikia')).toEqual({ isLate: false, lateReason: null });
  });
});
