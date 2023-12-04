exports.up = function (knex) {
  return knex.schema
    .alterTable('users', (table) => {
      table.string('address');
    })
    .alterTable('tenantUsers', (table) => {
      table.string('fullName');
      table.string('email');
      table.string('phone');
      table.string('address');
    });
};

exports.down = function (knex) {
  return knex.schema
    .alterTable('users', (table) => {
      table.dropColumn('address');
    })
    .alterTable('tenantUsers', (table) => {
      table.dropColumn('fullName');
      table.dropColumn('email');
      table.dropColumn('phone');
      table.dropColumn('address');
    });
};
