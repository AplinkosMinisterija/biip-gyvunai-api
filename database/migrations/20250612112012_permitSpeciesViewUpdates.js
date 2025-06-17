exports.up = function (knex) {
  return knex.raw(`
      DROP MATERIALIZED VIEW IF EXISTS public_permit_species;
      
      CREATE MATERIALIZED VIEW public_permit_species AS
      WITH filtered_permits AS (
          SELECT
              p.id AS permit_id,
              p.municipality,
              s.species_classifier_id
          FROM permits p
          JOIN permit_species s ON p.id = s.permit_id
          WHERE p.deleted_at IS NULL AND s.deleted_at IS NULL
      ),
      species_info AS (
          SELECT 
              sc.id AS species_classifier_id,
              sc.name,
              sc.name_latin
          FROM species_classifiers sc
      )
      SELECT 
          f.species_classifier_id AS species_id,
          si.name AS species,
          si.name_latin AS species_lot,
          COUNT(DISTINCT f.permit_id) AS total_permits,
          JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT(
              'id', f.municipality ->> 'id',
              'name', f.municipality ->> 'name'
          )) AS municipalities
      FROM filtered_permits f
      JOIN species_info si ON f.species_classifier_id = si.species_classifier_id
      GROUP BY f.species_classifier_id, si.name, si.name_latin;
    `);
};

exports.down = function (knex) {
  return knex.raw('DROP MATERIALIZED VIEW IF EXISTS public_permit_species');
};
