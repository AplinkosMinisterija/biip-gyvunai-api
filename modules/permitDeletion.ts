// AAD sprendimas (#85, 5 kl.): panaikinus leidimą, jo rūšys, gyvūnai, įrašai ir leidimo rūšių
// eilutės pažymimi panaikintais ta pačia data kaip ir leidimas. Pagal tą datą atstatant leidimą
// atstatomi tik kartu panaikinti duomenys, o ne tie, kuriuos naudotojas ištrynė anksčiau.
// Vienas SQL sakinys — leidimas ir jo duomenys pažymimi kartu arba nepažymimi visai.
// Jau panaikintų leidimų duomenys tokiu pat būdu pažymėti migracijoje 20261018130000.
// Pastaba: užklausa naudoja knex vardinius parametrus, todėl `::tipas` reikėtų rašyti `\\:\\:`.
export const REMOVE_PERMIT_WITH_DATA_SQL = `
  WITH permit AS (
    UPDATE permits
    SET deleted_at = now(), deleted_by = :userId
    WHERE id = :permitId AND deleted_at IS NULL
    RETURNING id, deleted_at, deleted_by
  ),
  permit_species_ids AS (
    SELECT s.id FROM species s JOIN permit ON s.permit_id = permit.id
  ),
  permit_animal_ids AS (
    SELECT a.id FROM animals a, permit
    WHERE a.permit_id = permit.id OR a.species_id IN (SELECT id FROM permit_species_ids)
  ),
  deleted_species AS (
    UPDATE species s
    SET deleted_at = permit.deleted_at, deleted_by = permit.deleted_by
    FROM permit
    WHERE s.id IN (SELECT id FROM permit_species_ids) AND s.deleted_at IS NULL
  ),
  deleted_permit_species AS (
    UPDATE permit_species ps
    SET deleted_at = permit.deleted_at, deleted_by = permit.deleted_by
    FROM permit
    WHERE ps.permit_id = permit.id AND ps.deleted_at IS NULL
  ),
  deleted_animals AS (
    UPDATE animals a
    SET deleted_at = permit.deleted_at, deleted_by = permit.deleted_by
    FROM permit
    WHERE a.id IN (SELECT id FROM permit_animal_ids) AND a.deleted_at IS NULL
  ),
  deleted_records AS (
    UPDATE records r
    SET deleted_at = permit.deleted_at, deleted_by = permit.deleted_by
    FROM permit
    WHERE r.deleted_at IS NULL
      AND (r.permit_id = permit.id
           OR r.species_id IN (SELECT id FROM permit_species_ids)
           OR r.animal_id IN (SELECT id FROM permit_animal_ids))
  )
  SELECT id FROM permit
`;
