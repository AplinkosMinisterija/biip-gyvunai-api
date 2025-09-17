export async function up(knex) {
  await knex.schema.alterTable('permits', (table) => {
    table.jsonb('tenants');
    table.jsonb('users');
  });

  await knex.raw(`
      UPDATE "permits"
      SET tenants = CASE 
        WHEN "tenantId" IS NOT NULL THEN jsonb_build_array("tenantId")
        ELSE '[]'::jsonb
      END,
      users = CASE 
        WHEN "userId" IS NOT NULL THEN jsonb_build_array("userId")
        ELSE '[]'::jsonb
      END
    `);

  // Pašalinam senus stulpelius
  await knex.schema.alterTable('permits', (table) => {
    table.dropColumn('tenantId');
    table.dropColumn('userId');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('permits', (table) => {
    table.integer('tenantId').unsigned();
    table.integer('userId').unsigned();
  });

  await knex.raw(`
      UPDATE "permits"
      SET "tenantId" = (tenants->>0)::int,
          "userId" = (users->>0)::int
    `);

  await knex.schema.alterTable('permits', (table) => {
    table.dropColumn('tenants');
    table.dropColumn('users');
  });
}
