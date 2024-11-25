exports.up = function (knex) {
  return knex.schema
    .raw(
      `ALTER TABLE "records" 
            DROP CONSTRAINT "records_type_check", 
            ADD CONSTRAINT "records_type_check" 
            CHECK ("type" IN ('ACQUIREMENT', 'BIRTH', 'DEATH', 'VACCINATION', 'SALE', 'TREATMENT', 'MARKING', 'PICK_UP_FROM_NATURE', 'OBTAINMENT_OF_FOSTERED_ANIMAL', 'RELEASE', 'TRANSFER','GENDER_CONFIRMATION','CERTIFICATE_NO'))`,
    )
    .alterTable('speciesClassifiers', (table) => {
      table.string('certificateNo');
    });
};
exports.down = function (knex) {
  return knex.schema
    .raw(
      `ALTER TABLE "records" 
            DROP CONSTRAINT "records_type_check", 
            ADD CONSTRAINT "records_type_check" 
            CHECK ("type" IN ('ACQUIREMENT', 'BIRTH', 'DEATH', 'VACCINATION', 'SALE', 'TREATMENT', 'MARKING', 'PICK_UP_FROM_NATURE', 'OBTAINMENT_OF_FOSTERED_ANIMAL', 'RELEASE', 'TRANSFER','GENDER_CONFIRMATION'))`,
    )
    .alterTable('speciesClassifiers', (table) => {
      table.dropColumn('certificateNo');
    });
};
