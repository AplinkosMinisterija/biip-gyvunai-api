exports.up = function (knex) {
  return knex.raw(`
      CREATE MATERIALIZED VIEW public_permits_by_cadastral_ids AS
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
            'permitSpecies', (
              SELECT json_agg(
                DISTINCT jsonb_build_object(
                  'id', ps.id,
                  'speciesClassifier', to_jsonb(sc),
                  'familyClassifiers', to_jsonb(fc)
                )
              )
              FROM permit_species ps
              LEFT JOIN species_classifiers sc ON ps.species_classifier_id = sc.id
              LEFT JOIN family_classifiers fc ON ps.family_classifier_id = fc.id
              WHERE ps.permit_id = p.id
            )
          )
        ) AS permits
      FROM
        permits p
        LEFT JOIN users u ON p.user_id = u.id
        LEFT JOIN tenants t ON p.tenant_id = t.id
        JOIN LATERAL jsonb_array_elements(p.cadastral_ids) AS plot ON true
      GROUP BY
        plot ->> 'cadastral_number';
    `);
};

exports.down = function (knex) {
  return knex.raw('DROP MATERIALIZED VIEW IF EXISTS public_permits_by_cadastral_ids;');
};
