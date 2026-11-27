/**
 * AAD sprendimas (#85, 35 kl., 2026-11-26): statusas „Leidimas panaikintas (reikalingas
 * perleidimas / iškėlimas)“ taikomas tik leidimams, panaikintiems po šio pakeitimo įdiegimo.
 * Jau panaikinti leidimai lieka nepakeisti, todėl esamoms eilutėms žyma nenustatoma.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('permits', (table) => {
    table.boolean('relocationRequired').notNullable().defaultTo(false);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('permits', (table) => {
    table.dropColumn('relocationRequired');
  });
};
