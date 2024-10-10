const {commonFields} = require("./20230405144107_setup");
exports.up = function (knex) {
    return knex.schema
    .createTable('familyClassifiers', (table) => {
        table.increments('id');
        table.string('name');
        table.string('nameLatin');
        commonFields(table);
    })
    .alterTable('speciesClassifiers', (table) => {
        table.integer('familyClassifierId').unsigned();
    });
};

exports.down = function (knex) {
    return knex.schema
    .dropTable('familyClassifiers')
    .alterTable('speciesClassifiers', (table) => {
        table.dropColumn('familyClassifierId');
    });
};
