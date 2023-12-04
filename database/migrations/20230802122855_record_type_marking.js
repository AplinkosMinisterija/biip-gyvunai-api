exports.up = function (knex) {
  return knex.schema.raw(`ALTER TABLE "records" 
        DROP CONSTRAINT "records_type_check", 
        ADD CONSTRAINT "records_type_check" 
        CHECK ("type" IN ('ACQUIREMENT', 'BIRTH', 'DEATH', 'VACCINATION', 'SALE', 'TREATMENT', 'MARKING'))`);
};

exports.down = function (knex) {
  return knex.schema.raw(`ALTER TABLE "records" 
        DROP CONSTRAINT "records_type_check", 
        ADD CONSTRAINT "records_type_check" 
        CHECK ("type" IN ('ACQUIREMENT', 'BIRTH', 'DEATH', 'VACCINATION', 'SALE', 'TREATMENT'))`);
};
