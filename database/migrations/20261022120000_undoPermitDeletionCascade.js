/**
 * AAD patikslinimas (#85, 5 kl., 2026-10-21): panaikinus leidimą jo gyvūnai lieka, kol perduodami
 * per žurnalo įrašus. Dev ir staging aplinkose migracijos 20261018130000 pirmoji versija ir
 * leidimų naikinimas jau pažymėjo panaikintų leidimų rūšis, gyvūnus, įrašus ir leidimo rūšių
 * eilutes panaikintais ta pačia data kaip ir leidimą. Ši migracija tai atšaukia.
 *
 * Kaskados požymis — eilutės `deleted_at` lygus jos leidimo `deleted_at`. Atskirai ištrinti
 * duomenys turi kitą datą ir lieka ištrinti. Paliestų rūšių kiekis perskaičiuojamas taip pat,
 * kaip migracijoje 20261005120000. Produkcijoje kaskada nevyko, todėl ten nieko nerandama.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const { rows } = await knex.raw(UNDO_CASCADE);
  const speciesIds = [...new Set(rows.map(({ speciesId }) => speciesId))];

  if (speciesIds.length) {
    await knex.raw(RECALCULATE_GROUP_AMOUNT, [speciesIds]);
    await knex.raw(RECALCULATE_INDIVIDUAL_AMOUNT, [speciesIds]);
  }

  await knex.raw('REFRESH MATERIALIZED VIEW public_permit_species');
  await knex.raw('REFRESH MATERIALIZED VIEW public_permits_by_cadastral_ids');
};

/**
 * Atšauktos kaskados atgal negrąžiname.
 *
 * @returns { Promise<void> }
 */
exports.down = async function () {};

// Vienas sakinys: visi CTE mato tą pačią pradinę būseną. Ryšiai renkami paprastais jungimais
// (be `OR`), kad užklausa nenuskaitytų lentelių kiekvienam leidimui iš naujo. Gyvūnai renkami
// visi (ne tik panaikinti), nes kaskada žymėjo ir anksčiau ištrintų gyvūnų įrašus.
// Grąžinamos rūšys, kurių kiekis gali pasikeisti.
const UNDO_CASCADE = `
  WITH deleted_permits AS (
    SELECT id, deleted_at FROM permits WHERE deleted_at IS NOT NULL
  ),
  permit_species_rows AS (
    SELECT s.id, s.deleted_at AS own_deleted_at, p.deleted_at
    FROM species s JOIN deleted_permits p ON s.permit_id = p.id
  ),
  permit_animals AS (
    SELECT a.id, a.species_id, a.deleted_at AS own_deleted_at, p.deleted_at
    FROM animals a JOIN deleted_permits p ON a.permit_id = p.id
    UNION
    SELECT a.id, a.species_id, a.deleted_at, s.deleted_at
    FROM animals a JOIN permit_species_rows s ON a.species_id = s.id
  ),
  cascaded_records AS (
    SELECT r.id FROM records r
    JOIN deleted_permits p ON r.permit_id = p.id AND r.deleted_at = p.deleted_at
    UNION
    SELECT r.id FROM records r
    JOIN permit_species_rows s ON r.species_id = s.id AND r.deleted_at = s.deleted_at
    UNION
    SELECT r.id FROM records r
    JOIN permit_animals a ON r.animal_id = a.id AND r.deleted_at = a.deleted_at
  ),
  restored_species AS (
    UPDATE species s
    SET deleted_at = NULL, deleted_by = NULL
    FROM permit_species_rows ps
    WHERE s.id = ps.id AND ps.own_deleted_at = ps.deleted_at
    RETURNING s.id
  ),
  restored_permit_species AS (
    UPDATE permit_species ps
    SET deleted_at = NULL, deleted_by = NULL
    FROM deleted_permits p
    WHERE ps.permit_id = p.id AND ps.deleted_at = p.deleted_at
  ),
  restored_animals AS (
    UPDATE animals a
    SET deleted_at = NULL, deleted_by = NULL
    FROM permit_animals pa
    WHERE a.id = pa.id AND pa.own_deleted_at = pa.deleted_at
    RETURNING a.species_id
  ),
  restored_records AS (
    UPDATE records r
    SET deleted_at = NULL, deleted_by = NULL
    FROM cascaded_records c
    WHERE r.id = c.id
    RETURNING r.species_id, r.animal_id
  )
  SELECT id AS "speciesId" FROM restored_species
  UNION
  SELECT species_id FROM restored_animals WHERE species_id IS NOT NULL
  UNION
  SELECT species_id FROM restored_records WHERE species_id IS NOT NULL
  UNION
  SELECT a.species_id FROM restored_records r JOIN animals a ON a.id = r.animal_id
  WHERE a.species_id IS NOT NULL
`;

// Toks pat perskaičiavimas kaip migracijoje 20261005120000, tik paliestoms rūšims.
const RECALCULATE_GROUP_AMOUNT = `
  UPDATE species s
  SET amount = COALESCE(r.total, 0)
  FROM (
    SELECT species_id,
           SUM(CASE
                 WHEN type IN ('ACQUIREMENT', 'BIRTH') THEN COALESCE(number_of_animals, 0)
                 WHEN type IN ('DEATH', 'SALE', 'TRANSFER', 'RELEASE') THEN -COALESCE(number_of_animals, 0)
                 ELSE 0
               END) FILTER (WHERE deleted_at IS NULL) AS total
    FROM records
    WHERE species_id = ANY(?)
    GROUP BY species_id
  ) r
  WHERE r.species_id = s.id
    AND s.deleted_at IS NULL
    AND s.type IS DISTINCT FROM 'INDIVIDUAL'
`;

const RECALCULATE_INDIVIDUAL_AMOUNT = `
  UPDATE species s
  SET amount = live.count
  FROM (
    SELECT an.species_id,
           COUNT(*) FILTER (
             WHERE an.deleted_at IS NULL
               AND NOT EXISTS (
                 SELECT 1
                 FROM records r
                 WHERE r.animal_id = an.id
                   AND r.deleted_at IS NULL
                   AND r.type IN ('DEATH', 'SALE', 'TRANSFER', 'RELEASE')
               )
           ) AS count
    FROM animals an
    WHERE an.species_id = ANY(?)
    GROUP BY an.species_id
  ) live
  WHERE live.species_id = s.id
    AND s.deleted_at IS NULL
    AND s.type = 'INDIVIDUAL'
`;
