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
    .createTable('users', (table) => {
      table.increments('id');
      table.integer('authUserId').unsigned();
      table.string('firstName', 255);
      table.string('lastName', 255);
      table.string('email', 255);
      table.string('phone', 255);
      table.timestamp('lastLogin');
      table.enu('type', ['USER', 'ADMIN']).defaultTo('USER');
      table.jsonb('tenants');
      commonFields(table);
    })
    .createTable('tenants', (table) => {
      table.increments('id');
      table.string('code');
      table.string('email');
      table.string('phone');
      table.string('name', 255);
      table.integer('authGroupId').unsigned();
      commonFields(table);
    })
    .createTable('tenantUsers', (table) => {
      table.increments('id');
      table.integer('tenantId').unsigned();
      table.integer('userId').unsigned();
      table.enu('role', ['USER', 'USER_ADMIN', 'OWNER']).defaultTo('USER');
      commonFields(table);
    })
    .createTable('speciesClassifiers', (table) => {
      table.increments('id');
      table.string('name');
      table.string('nameLatin');
      table.boolean('protected');
      table.boolean('invasive');
      commonFields(table);
    })
    .createTable('issuerClassifiers', (table) => {
      table.increments('id');
      table.string('name');
      table.string('nameShort');
      commonFields(table);
    })
    .createTable('markingTypeClassifiers', (table) => {
      table.increments('id');
      table.string('name');
      commonFields(table);
    })
    .createTable('permits', (table) => {
      table.increments('id');
      table.integer('permitNumber');
      table.timestamp('issueDate');
      table.integer('issuerId').unsigned();
      table.enu('type', ['ZOO', 'AVIARY']);
      table.string('address');
      table.jsonb('municipality');
      table.string('cadastralId');
      table.boolean('forest');
      table.timestamp('fencingOffDate');
      table.boolean('protectedTerritory');
      table.string('note');
      table.string('specialConditions');
      table.integer('tenantId').unsigned();
      table.integer('userId').unsigned();
      table.jsonb('permitSpecies');
      commonFields(table);
    })
    .createTable('species', (table) => {
      table.increments('id');
      table.integer('speciesId').unsigned();
      table.string('aviary');
      table.enu('possessionType', ['FOSTER', 'WITH_PERMIT']);
      table.integer('permitId').unsigned();
      table.enu('type', ['INDIVIDUAL', 'GROUP']);
      table.enu('units', ['UNIT', 'KG']);
      table.string('certificateNumber');
      table.string('address');
      table.jsonb('municipality');
      table.integer('tenantId').unsigned();
      table.integer('userId').unsigned();
      commonFields(table);
    })
    .createTable('animals', (table) => {
      table.increments('id');
      table.integer('speciesId').unsigned();
      table.integer('speciesClassifierId').unsigned();
      table.enu('gender', ['MALE', 'FEMALE']);
      table.timestamp('birthDate');
      table.string('certificate');
      table.string('markingNumber');
      table.integer('markingTypeId').unsigned();
      table.integer('tenantId').unsigned();
      table.integer('userId').unsigned();
      commonFields(table);
    })
    .createTable('records', (table) => {
      table.increments('id');
      table.integer('animalId').unsigned();
      table.integer('speciesId').unsigned();
      table.enu('type', ['ACQUIREMENT', 'BIRTH', 'DEATH', 'VACCINATION', 'SALE', 'TREATMENT']);
      table.timestamp('date');
      table.integer('numberOfAnimals');
      table.string('note');
      table.enu('deathReason', ['EUTHANIZED', 'FOUND_DEAD']);
      table.jsonb('acquiredFrom');
      table.timestamp('acquireDate');
      table.integer('tenantId').unsigned();
      table.integer('userId').unsigned();
      commonFields(table);
    });
};

exports.down = function (knex) {
  return knex.schema
    .dropTable('tenantUsers')
    .dropTable('tenants')
    .dropTable('users')
    .dropTable('speciesClassifiers')
    .dropTable('institutionClassifiers')
    .dropTable('markingTypeClassifiers')
    .dropTable('permits')
    .dropTable('species')
    .dropTable('animals')
    .dropTable('records');
};
