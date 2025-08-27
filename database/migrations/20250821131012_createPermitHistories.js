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
    table.enu('deleteReason', [
      'NON_COMPLIANCE',
      'REQUESTED_CANCELLATION',
      'ENTITY_DISSOLVED',
      'HOLDER_DECEASED',
      'DISEASE_OUTBREAK',
      'NO_ANIMALS_FOR_YEAR',
      'INSUFFICIENT_SPACE',
      'NO_ANIMALS_INTRODUCED',
      'FRAUDULENT_INFO',
      'EXPIRED',
      'OTHER',
    ]);
    table.text('deleteOtherReason');
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
