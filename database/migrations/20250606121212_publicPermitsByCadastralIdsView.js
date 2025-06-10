exports.up = function (knex) {
  return knex.raw(`
    CREATE MATERIALIZED VIEW public_permits_by_cadastral_ids AS
    WITH permit_species_data AS (
      SELECT
        ps.permit_id,
        json_agg(
        DISTINCT jsonb_build_object(
            'id', sc.id,
            'speciesClassifier', jsonb_build_object(
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
      json_agg(
       json_build_object(
          'permitNumber', p.permit_number,
          'issuedToUser', json_build_object(
            'firstName', u.first_name,
            'lastName', u.last_name
          ),
          'issuedToTenant', json_build_object(
            'name', t.name
          ),
          'id', p.id,
          'permitSpecies', psd.species_classifiers
        )
      ) AS permits
    FROM
      permits p
      LEFT JOIN users u ON p.user_id = u.id
      LEFT JOIN tenants t ON p.tenant_id = t.id
      LEFT JOIN permit_species_data psd ON psd.permit_id = p.id
      JOIN LATERAL jsonb_array_elements(p.cadastral_ids) AS plot ON true
    GROUP BY
      plot ->> 'cadastral_number';
    
  `);
};

exports.down = function (knex) {
  return knex.raw('DROP MATERIALIZED VIEW IF EXISTS public_permits_by_cadastral_ids;');
};
