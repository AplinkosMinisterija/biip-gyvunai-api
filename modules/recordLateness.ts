import moleculer from 'moleculer';
import { RecordType } from '../types';

// AAD sprendimas (#85, 25 kl.): duomenys pateikiami per 7 kalendorines dienas nuo įvykio
// (Taisyklių 74 p.). Vėliau įvestas ar patikslintas įrašas reikalauja priežasties ir visam
// laikui pažymimas „Vėluojantis / tikslintas“ (34 kl. a — tik po šio pakeitimo).
export const LATE_RECORD_DAYS = 7;

type DateValue = string | Date | null | undefined;

const DAY_MS = 24 * 60 * 60 * 1000;

// Dienos skaičiuojamos Lietuvos kalendoriumi: įvykis, įvestas 23:30, ir taisymas po 8 dienų
// 00:30 skiriasi 8 dienomis, kad ir kokia būtų serverio laiko juosta.
const vilniusDay = (date: Date) =>
  Date.parse(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vilnius' }).format(date));

export const isLateEventDate = (eventDate: DateValue, now = new Date()): boolean => {
  if (!eventDate) return false;
  const event = new Date(eventDate);
  if (Number.isNaN(event.getTime())) return false;

  return (vilniusDay(now) - vilniusDay(event)) / DAY_MS > LATE_RECORD_DAYS;
};

// Ženklinimo įvykis — ženklinimo data (žurnale ji rodoma vietoj įrašo datos).
export const recordEventDate = (record: {
  type?: string;
  date?: DateValue;
  markingDate?: DateValue;
}): DateValue =>
  record.type === RecordType.MARKING ? record.markingDate || record.date : record.date;

export type Lateness = { isLate: boolean; lateReason: string | null };

// Vėluojančiam įrašui priežastis privaloma; laiku įvestam ji nesaugoma.
export const resolveLateness = (eventDate: DateValue, lateReason?: unknown): Lateness => {
  if (!isLateEventDate(eventDate)) return { isLate: false, lateReason: null };

  const reason = typeof lateReason === 'string' ? lateReason.trim() : '';
  if (!reason) {
    throw new moleculer.Errors.MoleculerClientError(
      'A reason is required for a record entered more than 7 days after the event',
      422,
      'LATE_REASON_REQUIRED',
    );
  }

  return { isLate: true, lateReason: reason };
};
