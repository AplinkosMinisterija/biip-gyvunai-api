/**
 * AAD sprendimas (#85, 20 kl. a): 5 rūšių klasifikatorių poros su tuo pačiu lotynišku
 * pavadinimu sujungiamos — paliekamas lentelėje nurodytas lietuviškas pavadinimas, visos
 * nuorodos perkeliamos į jį, kitas įrašas pažymimas panaikintu. Po to lotyniškas pavadinimas
 * gali būti unikalus (2 kl., indeksas — migracijoje 20261026120100).
 *
 * Klasifikatoriai ieškomi pagal pavadinimus, ne id (aplinkose skiriasi). Jei aplinkoje poros
 * nėra arba nėra paliekamo įrašo — pora praleidžiama. Pakartotinai paleista migracija nieko
 * nebekeičia. Kaip sujungiama — taip pat kaip danielius migracijoje 20261018120000.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  for (const pair of PAIRS) {
    await mergePair(knex, pair);
  }

  await knex.raw('REFRESH MATERIALIZED VIEW public_permit_species');
  await knex.raw('REFRESH MATERIALIZED VIEW public_permits_by_cadastral_ids');
};

/**
 * Duomenų taisymas — atgalinis kelias neįmanomas (ankstesnės nuorodos nesaugomos).
 *
 * @returns { Promise<void> }
 */
exports.down = async function () {};

const PAIRS = [
  {
    nameLatin: 'Aulonocara jacobfreibergi',
    keep: 'Jakobfreibergo akara',
    drop: 'Aulonokara eureka',
  },
  { nameLatin: 'Cairina moschata', keep: 'Muskusinė antis', drop: 'Paprastoji muskusinė antis' },
  { nameLatin: 'Platycercus elegans', keep: 'Raudonoji rozela', drop: 'Penantinė rozela' },
  {
    nameLatin: 'Psephotus haematonotus',
    keep: 'Raudonsturplė plokščiauodegė papūga',
    drop: 'Raudonsturplės plokščiauodegės papūgos',
  },
  {
    nameLatin: 'Psittacula derbiana',
    keep: 'Kininė žieduotoji papūga',
    drop: 'Kinijos Aleksandras',
  },
];

// Kaip `normalizedSql` (modules/permitValidation.ts) ir indekse: abi pusės normalizuojamos SQL'e,
// tarpais laikomi ir tie, kurių PostgreSQL `[[:space:]]` neapima (chr(160) ir kt.).
const normalized = (expression) =>
  `lower(btrim(regexp_replace(${expression}, '[[:space:]' || chr(160) || chr(8199) || chr(8239) || chr(65279) || ']+', ' ', 'g')))`;

const findClassifiers = (knex, nameLatin, name) =>
  knex('speciesClassifiers')
    .whereNull('deletedAt')
    .whereRaw(`${normalized('name_latin')} = ${normalized('?')}`, [nameLatin])
    .whereRaw(`${normalized('name')} = ${normalized('?')}`, [name])
    .orderByRaw('(family_classifier_id IS NOT NULL) DESC, id ASC')
    .select('id', 'familyClassifierId');

async function mergePair(knex, { nameLatin, keep, drop }) {
  const [winner, ...sameNameDuplicates] = await findClassifiers(knex, nameLatin, keep);
  if (!winner) return;

  const loserIds = [...sameNameDuplicates, ...(await findClassifiers(knex, nameLatin, drop))].map(
    ({ id }) => id,
  );
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

  // Jei leidime atsidūrė dvi tos pačios rūšies eilutės — paliekama viena.
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
