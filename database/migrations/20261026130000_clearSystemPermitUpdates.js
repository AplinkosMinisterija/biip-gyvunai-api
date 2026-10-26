/**
 * AAD sprendimas (#85, 30 kl. a): atnaujinimo data rodo tik žmogaus pakeitimus, todėl sistemos
 * įrašytos datos išvalomos.
 *
 * Produkcijoje (patikra 2026-10-26, tik skaitymas) vienintelis sistemos atnaujinimas — 229
 * leidimai, pakeisti per dvi minutes 2025-10-03 08:54–08:55 UTC be naudotojo. Kiti leidimai be
 * `updated_by` iki 2025-10 yra administratorių pakeitimai: iki commit'o aefd523 (2025-08)
 * administratoriai neturėjo vietinio naudotojo, todėl `updated_by` likdavo tuščias. Jų datos
 * paliekamos. Kitose aplinkose tame lange įrašų nėra arba jie tokie pat sistemos.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex('permits')
    .whereNull('updatedBy')
    .where('updatedAt', '>=', SYSTEM_UPDATE_FROM)
    .where('updatedAt', '<', SYSTEM_UPDATE_TO)
    .update({ updatedAt: null });
};

/**
 * Išvalytų datų atkurti neįmanoma.
 *
 * @returns { Promise<void> }
 */
exports.down = async function () {};

const SYSTEM_UPDATE_FROM = '2025-10-03T08:54:00Z';
const SYSTEM_UPDATE_TO = '2025-10-03T08:56:00Z';
