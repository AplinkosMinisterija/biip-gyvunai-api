import { RecordType, Units } from '../types';

// Įrašų tipai, didinantys rūšies gyvūnų skaičių leidime.
export const INCOMING_RECORD_TYPES: RecordType[] = [RecordType.ACQUIREMENT, RecordType.BIRTH];

// Įrašų tipai, mažinantys rūšies gyvūnų skaičių leidime.
export const OUTGOING_RECORD_TYPES: RecordType[] = [
  RecordType.DEATH,
  RecordType.SALE,
  RecordType.TRANSFER,
  RecordType.RELEASE,
];

export const AMOUNT_RECORD_TYPES: RecordType[] = [
  ...INCOMING_RECORD_TYPES,
  ...OUTGOING_RECORD_TYPES,
];

type AmountRecord = { type: RecordType; numberOfAnimals?: number | null };
type AnimalRecord = { animal?: number | string | null };

// Grupinės apskaitos rūšis: suma per visus (visų naudotojų) nepašalintus įrašus.
export const calculateGroupAmount = (records: AmountRecord[]): number =>
  records.reduce((amount, record) => {
    const count = record.numberOfAnimals ?? 0;
    if (INCOMING_RECORD_TYPES.includes(record.type)) return amount + count;
    if (OUTGOING_RECORD_TYPES.includes(record.type)) return amount - count;
    return amount;
  }, 0);

// Individualios apskaitos rūšis: gyvūnai, neturintys nė vieno mažinančio įrašo.
export const calculateIndividualAmount = (
  animalIds: Array<number | string>,
  outgoingRecords: AnimalRecord[],
): number => {
  const gone = new Set(
    outgoingRecords
      .map((record) => record.animal)
      .filter((id): id is number | string => id !== null && id !== undefined)
      .map(Number),
  );

  return animalIds.filter((id) => !gone.has(Number(id))).length;
};

type SpeciesAmount = { units?: Units | null; amount?: number | null };

// AAD sprendimas (#85, 14 kl.): kilogramais apskaitomos rūšys viešoje statistikoje rodomos
// atskirai ir į vienetų sumą neįtraukiamos. Rūšis be nurodyto vieneto — vienetais.
export const amountByUnits = ({ units, amount }: SpeciesAmount) => {
  const value = amount ?? 0;
  return units === Units.KG ? { count: 0, countKg: value } : { count: value, countKg: 0 };
};
