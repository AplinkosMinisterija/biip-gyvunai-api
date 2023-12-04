exports.up = function (knex) {
  return knex.schema
    .alterTable('species', (table) => {
      table.renameColumn('speciesId', 'speciesClassifierId');
    })
    .alterTable('records', (table) => {
      table.integer('speciesClassifierId').unsigned();
      table.integer('permitId').unsigned();
    })
    .alterTable('permits', (table) => {
      table.renameColumn('document', 'file');
    })
    .alterTable('animals', (table) => {
      table.integer('permitId').unsigned();
    });
};

exports.down = function (knex) {
  return knex.schema
    .alterTable('species', (table) => {
      table.renameColumn('speciesClassifierId', 'speciesId');
    })
    .alterTable('records', (table) => {
      table.dropColumn('speciesClassifierId');
      table.dropColumn('permitId');
    })
    .alterTable('permits', (table) => {
      table.renameColumn('file', 'document');
    })
    .alterTable('animals', (table) => {
      table.dropColumn('permitId');
    });
};
