/**
 * AAD sprendimas (#85, 5 kl.): panaikinti leidimai nerodomi viešoje paieškoje pagal kadastro
 * numerį (iki šiol rodinys rodė ir juos, ir panaikintas leidimo rūšių eilutes).
 *
 * Iš pradžių ši migracija dar pažymėdavo panaikintais jau panaikintų leidimų duomenis. AAD tai
 * atšaukė (2026-10-21: gyvūnai lieka, kol perduodami), todėl ta dalis pašalinta prieš diegiant į
 * produkciją; dev ir staging aplinkose ją atšaukia migracija 20261022120000.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.raw(cadastralIdsView({ onlyActive: true }));
};

/**
 * Grąžinamas ankstesnis rodinys.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.raw(cadastralIdsView({ onlyActive: false }));
};

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
