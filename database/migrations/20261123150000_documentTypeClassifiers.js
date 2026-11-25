const { commonFields } = require('./20230405144107_setup');

/**
 * AAD sprendimai (#85, 10 kl. b, 28 ir 29 kl. a): prie kiekvieno žurnalo įrašo dokumento
 * pasirenkamas jo tipas iš sąrašo, kurį AAD tvarko administravimo aplinkoje. Pradinis sąrašas —
 * teisės aktuose numatyti dokumentai iš 10 kl. atsakymo ir „Kita“.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable('documentTypeClassifiers', (table) => {
    table.increments('id');
    table.string('name', 255).notNullable();
    commonFields(table);
  });

  await knex('documentTypeClassifiers').insert(
    INITIAL_TYPES.map((name) => ({ name, createdAt: new Date() })),
  );
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('documentTypeClassifiers');
};

const INITIAL_TYPES = [
  'Pirkimo–pardavimo sutartis / sąskaita faktūra',
  'CITES sertifikatas / leidimas',
  'AAD aktas / pažyma',
  'Perdavimo–priėmimo aktas',
  'Veterinarinė išvada',
  'Kita',
];
