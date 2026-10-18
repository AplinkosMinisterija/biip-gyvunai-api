import { Context } from 'moleculer';
import { RecordType } from '../services/records.service';

type DateValue = string | Date | null | undefined;

type MarkingRecord = {
  markingDate?: DateValue;
  date?: DateValue;
  createdAt?: DateValue;
};

const toTime = (value: DateValue) => (value ? new Date(value).getTime() || 0 : 0);

// AAD sprendimas (#85, 12 kl.): kortelėje rodomas paskutinio ženklinimo įrašas — pagal ženklinimo
// datą. Senuose įrašuose jos nėra, tada imama įrašo data; esant vienodai datai — vėliau įvestas.
// Rikiuojama čia, nes DB mažėjimo tvarka tuščias datas iškeltų į priekį.
export const latestMarkingRecord = <T extends MarkingRecord>(records: T[]): T | undefined =>
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
  const records: MarkingRecord[] = await ctx.broker.call('records.find', {
    query: { ...owner, type: RecordType.MARKING },
  });
  return latestMarkingRecord(records);
};
