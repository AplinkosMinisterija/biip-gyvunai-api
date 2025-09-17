export async function up(knex) {
  await knex.schema.alterTable('permits', (table) => {
    table.jsonb('users');
  });

  await knex.raw(`
      UPDATE "permits"
      SET users = CASE 
        WHEN "userId" IS NOT NULL THEN jsonb_build_array("userId")
        ELSE '[]'::jsonb
      END
    `);

  await knex.schema.alterTable('permits', (table) => {
    table.dropColumn('userId');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('permits', (table) => {
    table.integer('userId').unsigned();
  });

  await knex.raw(`
      UPDATE "permits"
      SET "userId" = (users->>0)::int
    `);

  await knex.schema.alterTable('permits', (table) => {
    table.dropColumn('users');
  });
}
