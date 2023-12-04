exports.up = function (knex) {
  return knex.schema.alterTable('permits', (table) => {
    table.decimal('fencedArea');
    table.decimal('aviarySizeIndoor').alter();
    table.decimal('aviarySizeOutdoor').alter();
    table.decimal('aviaryHeight').alter();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('permits', (table) => {
    table.dropColumn('fencedArea');
    table.integer('aviarySizeIndoor').alter();
    table.integer('aviarySizeOutdoor').alter();
    table.integer('aviaryHeight').alter();
  });
};
