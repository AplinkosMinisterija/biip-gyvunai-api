const { commonFields } = require('./20230405144107_setup');

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTableIfNotExists('permitHistories', (table) => {
    table.increments('id');
    table.integer('permitId').unsigned().notNullable();
    table.enu('type', ['CREATED', 'UPDATED', 'DELETED']).notNullable();
    commonFields(table);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTableIfExists('permitHistories');
};
