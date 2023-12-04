exports.up = function (knex) {
  return knex.schema
    .alterTable('permits', (table) => {
      table.jsonb('document');
    })
    .alterTable('species', (table) => {
      table.dropColumn('document');
    });
};

exports.down = function (knex) {
  return knex.schema
    .alterTable('permits', (table) => {
      table.dropColumn('document');
    })
    .alterTable('species', (table) => {
      table.jsonb('document');
    });
};
