/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createMaterializedView('publicPermitSpecies', (view) => {
    view.as(
      knex
        .select(
          'f.species_classifier_id AS species_id',
          'si.name AS species',
          'si.name_latin AS specie_lot',
          knex.raw('COUNT(DISTINCT f.permit_id) AS total_permits'),
          knex.raw(`
              JSON_AGG(DISTINCT JSONB_BUILD_OBJECT(
                'id', f.municipality ->> 'id',
                'name', f.municipality ->> 'name'
              )) AS municipalities
            `),
        )
        .from('permits p')
        .join('permit_species s', 'p.id', 's.permit_id')
        .join('species_classifiers si', 'f.species_classifier_id', 'si.id')
        .where('p.deleted_at', null)
        .andWhere('s.deleted_at', null)
        .groupBy('f.species_classifier_id', 'si.name', 'si.name_latin'),
    );
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropMaterializedView('publicPermitSpecies');
};
