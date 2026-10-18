import { Context } from 'moleculer';
import { RecordType } from '../types';

type DateValue = string | Date | null | undefined;

type DatedRecord = {
  markingDate?: DateValue;
  date?: DateValue;
  createdAt?: DateValue;
};

const toTime = (value: DateValue) => (value ? new Date(value).getTime() || 0 : 0);

// Kortelėje rodomas paskutinis įrašas pagal įvykio datą (#85, 11 ir 12 kl.): ženklinimo — pagal
// ženklinimo datą, o jos neturintis (senas ar ne ženklinimo) įrašas — pagal įrašo datą; esant
// vienodai datai — vėliau įvestas. Rikiuojama čia, nes DB mažėjimo tvarka tuščias datas iškeltų
// į priekį.
export const latestRecordByDate = <T extends DatedRecord>(records: T[]): T | undefined =>
  [...records].sort(
    (a, b) =>
      toTime(b.markingDate || b.date) - toTime(a.markingDate || a.date) ||
      toTime(b.createdAt) - toTime(a.createdAt),
  )[0];

// Visi ženklinimo įrašai imami be naudotojo filtro (kaip anksčiau per `records.findOne`): kortelė
// rodoma tik ją matančiam naudotojui, o įrašą galėjo įvesti kitas to leidimo naudotojas.
export const findLatestMarkingRecord = async (
  ctx: Context,
  owner: { animal: number } | { fosteredAnimal: number },
) => {
  const records: DatedRecord[] = await ctx.broker.call('records.find', {
    query: { ...owner, type: RecordType.MARKING },
  });
  return latestRecordByDate(records);
};
