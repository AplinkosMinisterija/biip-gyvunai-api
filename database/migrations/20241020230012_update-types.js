exports.up = function (knex) {
  return knex.schema
    .raw(
      `ALTER TABLE "records" 
          DROP CONSTRAINT "records_type_check", 
          ADD CONSTRAINT "records_type_check" 
          CHECK ("type" IN ('ACQUIREMENT', 'BIRTH', 'DEATH', 'VACCINATION', 'SALE', 'TREATMENT', 'MARKING', 'PICK_UP_FROM_NATURE', 'OBTAINMENT_OF_FOSTERED_ANIMAL', 'RELEASE', 'TRANSFER','GENDER_CONFIRMATION'))`,
    )
    .raw(
      `ALTER TABLE "animals"
      DROP CONSTRAINT "animals_gender_check",
      ADD CONSTRAINT "animals_gender_check"
      CHECK ("gender" IN ('MALE', 'FEMALE', 'UNIDENTIFIED', 'CLARIFIED_LATER'))`,
    )
    .raw(
      `ALTER TABLE "fostered_animals"
      DROP CONSTRAINT "fostered_animals_gender_check",
      ADD CONSTRAINT "fostered_animals_gender_check"
      CHECK ("gender" IN ('MALE', 'FEMALE', 'UNIDENTIFIED', 'CLARIFIED_LATER'))`,
    )
    .alterTable('records', (table) => {
      table.enu('gender', ['MALE', 'FEMALE', 'UNIDENTIFIED']);
      table.timestamp('confirmAt');
    });
};

exports.down = function (knex) {
  return knex.schema
    .raw(
      `ALTER TABLE "records" 
          DROP CONSTRAINT "records_type_check", 
          ADD CONSTRAINT "records_type_check" 
          CHECK ("type" IN ('ACQUIREMENT', 'BIRTH', 'DEATH', 'VACCINATION', 'SALE', 'TREATMENT', 'MARKING', 'PICK_UP_FROM_NATURE', 'OBTAINMENT_OF_FOSTERED_ANIMAL', 'RELEASE', 'TRANSFER'))`,
    )
    .raw(
      `ALTER TABLE "animals"
      DROP CONSTRAINT "animals_gender_check",
      ADD CONSTRAINT "animals_gender_check"
      CHECK ("gender" IN ('MALE', 'FEMALE'))`,
    )
    .raw(
      `ALTER TABLE "fostered_animals"
      DROP CONSTRAINT "fostered_animals_gender_check",
      ADD CONSTRAINT "fostered_animals_gender_check"
      CHECK ("gender" IN ('MALE', 'FEMALE'))`,
    )
    .alterTable('records', (table) => {
      table.dropColumn('gender');
      table.dropColumn('confirmAt');
    });
};
