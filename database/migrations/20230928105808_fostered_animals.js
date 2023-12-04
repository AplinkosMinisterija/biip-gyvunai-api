const commonFields = (table) => {
  table.timestamp('createdAt');
  table.integer('createdBy').unsigned();
  table.timestamp('updatedAt');
  table.integer('updatedBy').unsigned();
  table.timestamp('deletedAt');
  table.integer('deletedBy').unsigned();
};

exports.commonFields = commonFields;

exports.up = function (knex) {
  return knex.schema
    .createTable('fosteredAnimals', (table) => {
      table.increments('id');
      table.integer('speciesClassifierId').unsigned();
      table.enu('gender', ['MALE', 'FEMALE']);
      table.timestamp('date');
      table.string('certificateNumber');
      table.string('address');
      table.jsonb('municipality');
      table.integer('tenantId').unsigned();
      table.integer('userId').unsigned();
      commonFields(table);
    })
    .alterTable('records', (table) => {
      table.integer('fosteredAnimalId').unsigned();
      table.timestamp('vetExaminationDate');
      table.jsonb('municipality');
      table.jsonb('transferRecipient');
    });
};

exports.down = function (knex) {
  return knex.schema.dropTable('fosteredAnimals').alterTable('records', (table) => {
    table.dropColumn('fosteredAnimalId');
    table.dropColumn('vetExaminationDate');
    table.dropColumn('municipality');
    table.dropColumn('transferRecipient');
  });
};
