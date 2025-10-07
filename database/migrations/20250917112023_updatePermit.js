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

  await knex.raw(`
      DROP MATERIALIZED VIEW IF EXISTS public_permits_by_cadastral_ids;
  
      CREATE MATERIALIZED VIEW public_permits_by_cadastral_ids AS
      WITH permit_species_data AS (
        SELECT
          ps.permit_id,
          JSONB_AGG(
            DISTINCT JSONB_BUILD_OBJECT(
              'speciesClassifier', JSONB_BUILD_OBJECT(
                'id', sc.id,
                'name', sc.name,
                'nameLatin', sc.name_latin,
                'type', sc.type
              )
            )
          ) AS species_classifiers
        FROM permit_species ps
        JOIN species_classifiers sc ON ps.species_classifier_id = sc.id
        GROUP BY ps.permit_id
      ),
      permit_users AS (
        SELECT
          p.id AS permit_id,
          JSONB_AGG(
            DISTINCT JSONB_BUILD_OBJECT(
              'firstName', u.first_name,
              'lastName', u.last_name
            )
          ) AS issued_to_users
        FROM permits p
        JOIN LATERAL JSONB_ARRAY_ELEMENTS(p.users) AS user_elem(user_id) ON true
        LEFT JOIN users u ON u.id = (user_elem.user_id)::int
        GROUP BY p.id
      )
      SELECT
        plot ->> 'cadastral_number' AS cadastral_number,
        JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'permitNumber', p.permit_number,
            'issuedToUsers', pu.issued_to_users,
            'issuedToTenant', JSONB_BUILD_OBJECT('name', t.name),
            'id', p.id,
            'permitSpecies', psd.species_classifiers
          )
        ) AS permits
      FROM permits p
      LEFT JOIN tenants t ON p.tenant_id = t.id
      LEFT JOIN permit_species_data psd ON psd.permit_id = p.id
      LEFT JOIN permit_users pu ON pu.permit_id = p.id
      JOIN LATERAL JSONB_ARRAY_ELEMENTS(p.cadastral_ids) AS plot ON true
      GROUP BY plot ->> 'cadastral_number';
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
      WHERE JSONB_ARRAY_LENGTH(users) > 0
    `);

  await knex.schema.alterTable('permits', (table) => {
    table.dropColumn('users');
  });

  await knex.raw(`
      DROP MATERIALIZED VIEW IF EXISTS public_permits_by_cadastral_ids;
  
      CREATE MATERIALIZED VIEW public_permits_by_cadastral_ids AS
      WITH permit_species_data AS (
        SELECT
          ps.permit_id,
          JSONB_AGG(
            DISTINCT JSONB_BUILD_OBJECT(
              'speciesClassifier', JSONB_BUILD_OBJECT(
                'id', sc.id,
                'name', sc.name,
                'nameLatin', sc.name_latin,
                'type', sc.type
              )
            )
          ) AS species_classifiers
        FROM permit_species ps
        JOIN species_classifiers sc ON ps.species_classifier_id = sc.id
        GROUP BY ps.permit_id
      )
      SELECT
        plot ->> 'cadastral_number' AS cadastral_number,
        JSONB_AGG(
          JSONB_BUILD_OBJECT(
            'permitNumber', p.permit_number,
            'issuedToUser', JSONB_BUILD_OBJECT(
              'firstName', u.first_name,
              'lastName', u.last_name
            ),
            'issuedToTenant', JSONB_BUILD_OBJECT('name', t.name),
            'id', p.id,
            'permitSpecies', psd.species_classifiers
          )
        ) AS permits
      FROM permits p
      LEFT JOIN users u ON p.user_id = u.id
      LEFT JOIN tenants t ON p.tenant_id = t.id
      LEFT JOIN permit_species_data psd ON psd.permit_id = p.id
      JOIN LATERAL JSONB_ARRAY_ELEMENTS(p.cadastral_ids) AS plot ON true
      GROUP BY plot ->> 'cadastral_number';
    `);
};
