exports.up = function (knex) {
  return knex.schema.alterTable('speciesClassifiers', (table) => {
    table.dropColumn('protected');
    table.dropColumn('invasive');
    table.enu('type', ['PROTECTED', 'INVASIVE']);
  });
};

exports.down = function (knex) {
  return knex.schema
    .alterTable('speciesClassifiers', (table) => {
      table.renameColumn('speciesClassifierId', 'speciesId');
    })
    .alterTable('records', (table) => {
      table.dropColumn('type');
      table.boolean('protected');
      table.boolean('invasive');
    });
};
