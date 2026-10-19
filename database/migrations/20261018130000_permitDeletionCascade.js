/**
 * AAD sprendimas (#85, 5 kl.): panaikinto leidimo duomenys nerodomi viešai.
 *
 * - Viešos paieškos pagal kadastro numerį rodinys perkuriamas be panaikintų leidimų ir
 *   panaikintų leidimo rūšių eilučių (iki šiol rodė ir juos).
 * - Jau panaikintų leidimų rūšys, gyvūnai, įrašai ir leidimo rūšių eilutės pažymimi
 *   panaikintais ta pačia data kaip ir leidimas — taip daro ir naikinimas nuo šiol, o
 *   atstatant leidimą atstatomi tik su juo kartu panaikinti duomenys.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.raw(cadastralIdsView({ onlyActive: true }));
  await knex.raw(CASCADE_EXISTING_DELETIONS);
  await knex.raw('REFRESH MATERIALIZED VIEW public_permit_species');
};

/**
 * Grąžinamas ankstesnis rodinys. Pažymėti panaikintais vaikai paliekami — jie priklauso
 * panaikintiems leidimams.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.raw(cadastralIdsView({ onlyActive: false }));
};

const CASCADE_EXISTING_DELETIONS = `
  WITH deleted_permits AS (
    SELECT id, deleted_at, deleted_by FROM permits WHERE deleted_at IS NOT NULL
  ),
  deleted_species AS (
    UPDATE species s
    SET deleted_at = p.deleted_at, deleted_by = p.deleted_by
    FROM deleted_permits p
    WHERE s.permit_id = p.id AND s.deleted_at IS NULL
    RETURNING s.id, s.deleted_at, s.deleted_by
  ),
  deleted_permit_species AS (
    UPDATE permit_species ps
    SET deleted_at = p.deleted_at, deleted_by = p.deleted_by
    FROM deleted_permits p
    WHERE ps.permit_id = p.id AND ps.deleted_at IS NULL
    RETURNING ps.id
  ),
  deleted_animals AS (
    UPDATE animals a
    SET deleted_at = p.deleted_at, deleted_by = p.deleted_by
    FROM deleted_permits p
    WHERE a.deleted_at IS NULL
      AND (a.permit_id = p.id
           OR a.species_id IN (SELECT id FROM species WHERE permit_id = p.id))
    RETURNING a.id
  )
  UPDATE records r
  SET deleted_at = p.deleted_at, deleted_by = p.deleted_by
  FROM deleted_permits p
  WHERE r.deleted_at IS NULL
    AND (r.permit_id = p.id
         OR r.species_id IN (SELECT id FROM species WHERE permit_id = p.id)
         OR r.animal_id IN (
           SELECT a.id FROM animals a
           JOIN species s ON s.id = a.species_id
           WHERE s.permit_id = p.id
         ))
`;

const cadastralIdsView = ({ onlyActive }) => `
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
    ${onlyActive ? 'WHERE ps.deleted_at IS NULL' : ''}
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
  ${onlyActive ? 'WHERE p.deleted_at IS NULL' : ''}
  GROUP BY plot ->> 'cadastral_number';
`;
