exports.up = function (knex) {
  return knex.schema.alterTable('species', (table) => {
    table.jsonb('document');
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('species', (table) => {
    table.dropColumn('document');
  });
};
