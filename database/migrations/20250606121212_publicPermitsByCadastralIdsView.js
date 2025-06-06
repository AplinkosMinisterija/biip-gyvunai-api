exports.up = function (knex) {
  return knex.raw(`
  CREATE MATERIALIZED VIEW public_permits_by_cadastral_ids AS
SELECT
    plot ->> 'cadastral_number' AS cadastral_number,
    json_agg(DISTINCT jsonb_build_object(
        'permit_species_id', ps.id,
        'species_classifier', to_jsonb(sc),
        'family_classifiers', to_jsonb(fc)
    )) AS permit_species,
    json_agg(json_build_object(
        'permit_number', p.permit_number,
        'issued_to_user', json_build_object(
            'name', u.first_name,
            'lastname', u.last_name
        ),
        'issued_to_tenant', json_build_object(
            'name', t.name
        ),
        'permit_id', p.id
    )) AS permits
FROM
    permits p
LEFT JOIN users u ON p.user_id = u.id
LEFT JOIN tenants t ON p.tenant_id = t.id
LEFT JOIN permit_species ps ON p.id = ps.permit_id
LEFT JOIN species_classifiers sc ON ps.species_classifier_id = sc.id
LEFT JOIN family_classifiers fc ON ps.family_classifier_id = fc.id
JOIN LATERAL jsonb_array_elements(p.cadastral_ids) AS plot ON true
GROUP BY
    plot ->> 'cadastral_number';
    `);
};

exports.down = function (knex) {
  return knex.raw('DROP MATERIALIZED VIEW IF EXISTS public_permits_by_cadastral_ids');
};
