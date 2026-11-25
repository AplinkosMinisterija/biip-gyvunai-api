import { isEqual } from 'lodash';

// AAD sprendimas (#85, 27 kl. a): taisomi įrašo duomenys. Įrašo tipas, gyvūnas, rūšis ir
// leidimas nekeičiami — klaidingą įrašą reikia anuliuoti ir įvesti naują, kitaip nutrūktų
// gyvūno įrašų grandinė.
export const RECORD_EDITABLE_FIELDS = [
  'date',
  'numberOfAnimals',
  'note',
  'certificateNo',
  'markingNumber',
  'markingCertificateNo',
  'markingType',
  'markingDate',
  'acquiredFrom',
  'acquireDate',
  'transferRecipient',
  'municipality',
  'vaccineName',
  'deathReason',
  'vetExaminationDate',
  'file',
] as const;

export type RecordEditableField = (typeof RECORD_EDITABLE_FIELDS)[number];

export type RecordChanges = Partial<Record<RecordEditableField, { old: unknown; new: unknown }>>;

export const RECORD_DATE_FIELDS = [
  'date',
  'markingDate',
  'acquireDate',
  'vetExaminationDate',
] as const;

// Palyginama ta pati reikšmė skirtingais pavidalais: data iš DB (Date) ir iš formos (eilutė),
// užpildytas ženklinimo būdas (objektas) ir jo id, tuščia eilutė ir `null`.
export const normalizeRecordValue = (field: string, value: unknown): unknown => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;

  if ((RECORD_DATE_FIELDS as readonly string[]).includes(field)) {
    const time = new Date(value as string | Date).getTime();
    return Number.isNaN(time) ? value : new Date(time).toISOString();
  }
  if (field === 'markingType') {
    return Number(typeof value === 'object' ? (value as { id: unknown }).id : value);
  }
  if (field === 'numberOfAnimals') return Number(value);

  return value;
};

// Pakeisti laukai: tik perduoti ir nuo saugomų besiskiriantys.
export const diffRecord = (
  previous: Partial<Record<string, unknown>>,
  params: Partial<Record<string, unknown>>,
): RecordChanges => {
  const changes: RecordChanges = {};

  for (const field of RECORD_EDITABLE_FIELDS) {
    if (params[field] === undefined) continue;

    const oldValue = normalizeRecordValue(field, previous[field]) ?? null;
    const newValue = normalizeRecordValue(field, params[field]);
    if (!isEqual(oldValue, newValue)) {
      changes[field] = { old: oldValue, new: newValue };
    }
  }

  return changes;
};
