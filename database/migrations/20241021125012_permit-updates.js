const { commonFields } = require('./20230405144107_setup');
exports.up = function (knex) {
  return knex.schema
    .createTable('permitSpecies', (table) => {
      table.increments('id');
      table.integer('familyClassifierId').unsigned();
      table.integer('speciesClassifierId').unsigned();
      table.integer('permitId').unsigned();
      commonFields(table);
    })
    .alterTable('permits', (table) => {
      table.dropColumn('cadastralId');
      table.dropColumn('permitSpecies');
      table.jsonb('cadastralIds');
      table.string('info');
    });
};

exports.down = function (knex) {
  return knex.schema.dropTable('permitSpecies').alterTable('permits', (table) => {
    table.dropColumn('cadastralIds');
    table.dropColumn('info');
    table.string('cadastralId');
    table.jsonb('permitSpecies');
  });
};
