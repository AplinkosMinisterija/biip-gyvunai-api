exports.up = function (knex) {
  return knex.schema.alterTable('species', (table) => {
    table.integer('amount');
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('species', (table) => {
    table.dropColumn('amount');
  });
};
