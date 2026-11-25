/**
 * AAD sprendimas (#85, 2 kl.): aktyvaus rūšies klasifikatoriaus lotyniškas pavadinimas unikalus
 * (be didžiųjų raidžių ir tarpų skirtumų — ta pati išraiška kaip `normalizedSql` programoje).
 * Iki šiol tai tikrino tik programa; produkcijos dublikatai sujungti migracijoje 20261026120000.
 *
 * Jei aplinkoje (pvz. dev ar staging su testiniais duomenimis) dublikatų dar liko, indeksas
 * nekuriamas ir išvedamas jų sąrašas — konteineris nestringa perkrovimų cikle, o programos
 * patikra ir toliau neleidžia naujų dublikatų.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const { rows } = await knex.raw(`
    SELECT ${NORMALIZED_LATIN} AS "nameLatin", array_agg(id ORDER BY id) AS ids
    FROM species_classifiers
    WHERE ${ACTIVE_WITH_LATIN}
    GROUP BY 1
    HAVING count(*) > 1
  `);

  if (rows.length) {
    const list = rows.map(({ nameLatin, ids }) => `${nameLatin} (${ids.join(', ')})`).join('; ');
    // eslint-disable-next-line no-console
    console.warn(`Unique Latin name index skipped, classifiers share a Latin name: ${list}`);
    return;
  }

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${INDEX_NAME}
    ON species_classifiers (${NORMALIZED_LATIN})
    WHERE ${ACTIVE_WITH_LATIN}
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS ${INDEX_NAME}`);
};

const INDEX_NAME = 'species_classifiers_name_latin_unique';
const NORMALIZED_LATIN = `lower(btrim(regexp_replace(name_latin, '[[:space:]' || chr(160) || chr(8199) || chr(8239) || chr(65279) || ']+', ' ', 'g')))`;
const ACTIVE_WITH_LATIN = `deleted_at IS NULL AND ${NORMALIZED_LATIN} <> ''`;
