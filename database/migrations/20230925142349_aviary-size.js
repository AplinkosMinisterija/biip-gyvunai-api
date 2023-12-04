exports.up = function (knex) {
  return knex.schema.alterTable('permits', (table) => {
    table.integer('aviarySizeIndoor');
    table.integer('aviarySizeOutdoor');
    table.integer('aviaryHeight');
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('permits', (table) => {
    table.dropColumn('aviarySizeIndoor');
    table.dropColumn('aviarySizeOutdoor');
    table.dropColumn('aviaryHeight');
  });
};
