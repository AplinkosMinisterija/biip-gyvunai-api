/**
 * AAD sprendimai (#85):
 * - 19 kl.: išorinė sistema, pridedant rūšį iš leidimo puslapio, vietoj klasifikatoriaus
 *   išsaugodavo leidimo rūšių eilutės (`permit_species`) id. Tokia rūšis (ir jos įrašai bei
 *   gyvūnai) gauna tos eilutės klasifikatorių. Taisoma tik tada, kai dabartinis klasifikatorius
 *   leidimo neatitinka, kad atsitiktinai sutapęs id nepakeistų teisingos rūšies.
 * - 1 kl.: „Danielius (Dama dama)“ ir „Danielius (Cervus dama)“ — ta pati rūšis. Paliekamas
 *   vienas klasifikatorius su lotynišku pavadinimu „Dama dama“, visos nuorodos perkeliamos į jį.
 *
 * Klasifikatoriai ieškomi pagal pavadinimus, ne id: PROD ir staging duomenys skiriasi
 * (PROD — vienas aktyvus „Cervus dama“, staging — keli). Pakartotinai paleista migracija
 * nieko nebekeičia. Materializuoti rodiniai atnaujinami pabaigoje, nes migracija servisų
 * įvykių nesukelia.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await fixSpeciesSavedWithPermitRowId(knex);
  await mergeDanielius(knex);

  await knex.raw('REFRESH MATERIALIZED VIEW public_permit_species');
  await knex.raw('REFRESH MATERIALIZED VIEW public_permits_by_cadastral_ids');
};

async function fixSpeciesSavedWithPermitRowId(knex) {
  const { rows } = await knex.raw(`
    SELECT s.id AS "speciesId", ps.species_classifier_id AS "classifierId"
    FROM species s
    JOIN permit_species ps
      ON ps.id = s.species_classifier_id
     AND ps.permit_id = s.permit_id
     AND ps.deleted_at IS NULL
     AND ps.species_classifier_id IS NOT NULL
    LEFT JOIN species_classifiers sc ON sc.id = s.species_classifier_id
    WHERE s.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM permit_species allowed
        WHERE allowed.permit_id = s.permit_id
          AND allowed.deleted_at IS NULL
          AND (allowed.species_classifier_id = s.species_classifier_id
               OR (allowed.species_classifier_id IS NULL
                   AND allowed.family_classifier_id = sc.family_classifier_id))
      )
  `);

  for (const { speciesId, classifierId } of rows) {
    await knex('species').where({ id: speciesId }).update({ speciesClassifierId: classifierId });
    await knex('animals').where({ speciesId }).update({ speciesClassifierId: classifierId });
    await knex('records')
      .where({ speciesId })
      .orWhereIn('animalId', knex('animals').select('id').where({ speciesId }))
      .update({ speciesClassifierId: classifierId });
  }
}

async function mergeDanielius(knex) {
  const candidates = await knex('speciesClassifiers')
    .whereNull('deletedAt')
    .whereRaw(`lower(btrim(name)) = 'danielius'`)
    .whereRaw(
      `lower(btrim(regexp_replace(name_latin, '\\s+', ' ', 'g'))) IN ('dama dama', 'cervus dama')`,
    )
    .orderByRaw(
      `(lower(btrim(regexp_replace(name_latin, '\\s+', ' ', 'g'))) = 'dama dama') DESC,
       (family_classifier_id IS NOT NULL) DESC,
       id ASC`,
    )
    .select('id', 'familyClassifierId');

  if (!candidates.length) return;

  const [winner, ...losers] = candidates;
  const loserIds = losers.map(({ id }) => id);

  await knex('speciesClassifiers')
    .where({ id: winner.id })
    .update({ name: 'Danielius', nameLatin: 'Dama dama' });

  if (!loserIds.length) return;

  for (const table of ['species', 'records', 'animals', 'fosteredAnimals']) {
    await knex(table)
      .whereIn('speciesClassifierId', loserIds)
      .update({ speciesClassifierId: winner.id });
  }

  await knex('permitSpecies')
    .whereIn('speciesClassifierId', loserIds)
    .update({
      speciesClassifierId: winner.id,
      ...(winner.familyClassifierId ? { familyClassifierId: winner.familyClassifierId } : {}),
    });

  // Leidime abu danieliai (ar tas pats danielius kelis kartus) — paliekama viena eilutė.
  await knex.raw(
    `
    UPDATE permit_species ps
    SET deleted_at = now()
    FROM (
      SELECT id, row_number() OVER (PARTITION BY permit_id ORDER BY id) AS position
      FROM permit_species
      WHERE species_classifier_id = ? AND deleted_at IS NULL
    ) duplicate
    WHERE ps.id = duplicate.id AND duplicate.position > 1
  `,
    [winner.id],
  );

  await knex('speciesClassifiers').whereIn('id', loserIds).update({ deletedAt: knex.fn.now() });
}

/**
 * Duomenų taisymas — atgalinis kelias neįmanomas (ankstesnės nuorodos nesaugomos).
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function () {};
