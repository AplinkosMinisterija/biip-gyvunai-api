exports.up = async function (knex) {
  await knex.schema.alterTable('permits', (table) => {
    table.jsonb('users');
  });

  await knex.raw(`
      UPDATE "permits"
      SET users = CASE
        WHEN "user_id" IS NOT NULL THEN jsonb_build_array("user_id")
        ELSE '[]'::jsonb
      END
    `);

  await knex.schema.alterTable('permits', (table) => {
    table.dropColumn('userId');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('permits', (table) => {
    table.integer('userId').unsigned();
  });

  await knex.raw(`
      UPDATE "permits"
      SET "user_id" = (users->>0)::int
      WHERE jsonb_array_length(users) > 0
    `);

  await knex.schema.alterTable('permits', (table) => {
    table.dropColumn('users');
  });
};
