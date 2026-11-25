const { commonFields } = require('./20230405144107_setup');

/**
 * AAD sprendimai (#85):
 * - 33 kl. a: žurnalo įrašų niekas netrina. Laikytojas ir AAD anuliuoja įrašą nurodę priežastį;
 *   anuliuotas įrašas nebeskaičiuojamas, bet lieka matomas su žyma.
 * - 27 kl. a: įrašo duomenys taisomi nurodžius priežastį, pakeitimai saugomi istorijoje.
 * - 25 kl., 34 kl. a: po šio pakeitimo vėliau nei per 7 dienas nuo įvykio įvestas ar
 *   patikslintas įrašas visam laikui pažymimas vėluojančiu.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('records', (table) => {
    table.timestamp('annulledAt');
    table.integer('annulledBy').unsigned();
    table.text('annulReason');
    table.boolean('isLate').notNullable().defaultTo(false);
    table.text('lateReason');
  });

  await knex.schema.createTable('recordHistories', (table) => {
    table.increments('id');
    // Be išorinio rakto, kaip `permitHistories`: įrašai tik pažymimi panaikintais.
    table.integer('recordId').unsigned().notNullable();
    table.enu('type', ['UPDATED', 'ANNULLED']).notNullable();
    table.text('reason').notNullable();
    // Pakeisti laukai: { laukas: { old, new } }.
    table.jsonb('changes');
    commonFields(table);
    table.index('recordId');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('recordHistories');
  await knex.schema.alterTable('records', (table) => {
    table.dropColumn('annulledAt');
    table.dropColumn('annulledBy');
    table.dropColumn('annulReason');
    table.dropColumn('isLate');
    table.dropColumn('lateReason');
  });
};
