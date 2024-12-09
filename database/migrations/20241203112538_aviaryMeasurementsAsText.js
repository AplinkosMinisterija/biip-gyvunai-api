exports.up = function (knex) {
    return knex.schema.alterTable('permits', (table) => {
        table.string('aviarySizeIndoor').alter();
        table.string('aviarySizeOutdoor').alter();
        table.string('aviaryHeight').alter();
    });
};
exports.down = function (knex) {
    return knex.schema.alterTable('permits', (table) => {
        table.dropColumns(['aviarySizeIndoor', 'aviarySizeOutdoor', 'aviaryHeight']);
        table.integer('aviarySizeIndoor');
        table.integer('aviarySizeOutdoor');
        table.integer('aviaryHeight');
    });
};
