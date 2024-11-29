exports.up = function (knex) {
  return knex.schema.alterTable('permits', (table) => {
    table.text('specialConditions').alter();
    table.text('info').alter();
    table.text('note').alter();
  });
};
exports.down = function (knex) {
  return knex.schema.alterTable('permits', (table) => {
    table.string('specialConditions').alter();
    table.string('note').alter();
    table.string('info').alter();
  });
};
