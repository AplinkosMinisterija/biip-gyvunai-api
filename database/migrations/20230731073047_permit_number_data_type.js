exports.up = function (knex) {
  return knex.schema.alterTable('permits', (table) => {
    table.string('permitNumber').alter();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('permits', (table) => {
    table.integer('permitNumber').alter();
  });
};
