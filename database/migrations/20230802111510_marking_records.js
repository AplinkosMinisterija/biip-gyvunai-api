exports.up = function (knex) {
  return knex.schema
    .alterTable('records', (table) => {
      table.string('markingNumber');
      table.integer('markingTypeId').unsigned();
      table.jsonb('file');
    })
    .alterTable('animals', (table) => {
      table.dropColumn('markingNumber');
      table.dropColumn('markingTypeId');
    });
};

exports.down = function (knex) {
  return knex.schema
    .alterTable('records', (table) => {
      table.dropColumn('markingNumber');
      table.dropColumn('markingTypeId');
      table.dropColumn('file');
    })
    .alterTable('animals', (table) => {
      table.string('markingNumber');
      table.number('markingTypeId').unsigned();
    });
};
