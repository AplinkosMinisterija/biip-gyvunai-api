'use strict';

import {
  AMOUNT_RECORD_TYPES,
  INCOMING_RECORD_TYPES,
  OUTGOING_RECORD_TYPES,
  calculateGroupAmount,
  calculateIndividualAmount,
} from '../modules/speciesAmount';
import { RecordType } from '../types';

describe('species amount calculators', () => {
  it('classifies incoming and outgoing record types', () => {
    expect(INCOMING_RECORD_TYPES).toEqual([RecordType.ACQUIREMENT, RecordType.BIRTH]);
    expect(OUTGOING_RECORD_TYPES).toEqual([
      RecordType.DEATH,
      RecordType.SALE,
      RecordType.TRANSFER,
      RecordType.RELEASE,
    ]);
    expect(AMOUNT_RECORD_TYPES).toEqual([...INCOMING_RECORD_TYPES, ...OUTGOING_RECORD_TYPES]);
  });

  describe('calculateGroupAmount', () => {
    it('adds incoming and subtracts outgoing records, including transfers and releases', () => {
      const amount = calculateGroupAmount([
        { type: RecordType.ACQUIREMENT, numberOfAnimals: 10 },
        { type: RecordType.BIRTH, numberOfAnimals: 4 },
        { type: RecordType.DEATH, numberOfAnimals: 2 },
        { type: RecordType.SALE, numberOfAnimals: 1 },
        { type: RecordType.TRANSFER, numberOfAnimals: 3 },
        { type: RecordType.RELEASE, numberOfAnimals: 1 },
      ]);

      expect(amount).toBe(7);
    });

    it('ignores records that do not change the stock', () => {
      const amount = calculateGroupAmount([
        { type: RecordType.ACQUIREMENT, numberOfAnimals: 5 },
        { type: RecordType.VACCINATION, numberOfAnimals: 5 },
        { type: RecordType.MARKING, numberOfAnimals: 5 },
        { type: RecordType.OTHER, numberOfAnimals: 5 },
      ]);

      expect(amount).toBe(5);
    });

    it('treats a missing count as zero and an empty list as zero', () => {
      expect(
        calculateGroupAmount([
          { type: RecordType.ACQUIREMENT, numberOfAnimals: 3 },
          { type: RecordType.DEATH, numberOfAnimals: null },
          { type: RecordType.BIRTH },
        ]),
      ).toBe(3);
      expect(calculateGroupAmount([])).toBe(0);
    });
  });

  describe('calculateIndividualAmount', () => {
    it('counts animals without an outgoing record', () => {
      const amount = calculateIndividualAmount(
        [1, 2, 3, 4],
        [{ animal: 2 }, { animal: 4 }, { animal: 4 }],
      );

      expect(amount).toBe(2);
    });

    it('compares ids numerically and skips records without an animal', () => {
      expect(calculateIndividualAmount(['7', 8], [{ animal: 7 }, { animal: null }])).toBe(1);
    });
  });
});
