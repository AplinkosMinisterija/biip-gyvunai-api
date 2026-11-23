/**
 * AAD sprendimas (#85, 21 ir 32 kl. a): testinis leidimas „Test Kristina“ su visais jo
 * duomenimis pašalinamas vienkartiniu duomenų pataisymu.
 *
 * Paprasto leidimo panaikinimo neužtenka: panaikinto leidimo rūšys ir gyvūnai lieka
 * statistikoje (5 kl.). Todėl kartu su leidimu pažymimos panaikintomis jo rūšys, gyvūnai,
 * žurnalo įrašai ir leidimo rūšių eilutės, o istorijoje įrašomas panaikinimas su priežastimi.
 * Jei leidimą kas nors jau panaikino administravime, pažymimi tik jo duomenys.
 *
 * Duomenys gauna kitą panaikinimo laiką nei leidimas: vienodas laikas reiškia leidimo
 * panaikinimo pakopą, kurią atšaukia migracija `20261022120000_undoPermitDeletionCascade`.
 *
 * Leidimas ieškomas pagal numerį ir išdavimo datą, ne id. Produkcijoje (patikra 2026-11-23,
 * tik skaitymas) toks leidimas vienas; kitose aplinkose jo gali nebūti — tada nieko nedaroma.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const permits = await knex('permits')
    .where({ permitNumber: TEST_PERMIT_NUMBER, issueDate: TEST_PERMIT_ISSUE_DATE })
    .select('id', 'deletedAt');

  if (!permits.length) return;

  const permitIds = permits.map(({ id }) => id);
  const dataDeletedAt = new Date();
  const permitDeletedAt = new Date(dataDeletedAt.getTime() + 1000);
  const markDeleted = (query) => query.whereNull('deletedAt').update({ deletedAt: dataDeletedAt });

  const species = knex('species').select('id').whereIn('permitId', permitIds);
  const animals = knex('animals')
    .select('id')
    .whereIn('permitId', permitIds)
    .orWhereIn('speciesId', species);

  const counts = {
    records: await markDeleted(
      knex('records').where((query) =>
        query
          .whereIn('permitId', permitIds)
          .orWhereIn('speciesId', species)
          .orWhereIn('animalId', animals),
      ),
    ),
    animals: await markDeleted(knex('animals').whereIn('id', animals)),
    species: await markDeleted(knex('species').whereIn('permitId', permitIds)),
    permitSpecies: await markDeleted(knex('permitSpecies').whereIn('permitId', permitIds)),
  };

  const activePermitIds = permits.filter(({ deletedAt }) => !deletedAt).map(({ id }) => id);
  if (activePermitIds.length) {
    await knex('permits').whereIn('id', activePermitIds).update({
      deletedAt: permitDeletedAt,
      deleteReason: DELETE_REASON,
      deleteOtherReason: DELETE_OTHER_REASON,
    });
    await knex('permitHistories').insert(
      activePermitIds.map((permitId) => ({
        permitId,
        type: 'DELETED',
        deleteReason: DELETE_REASON,
        deleteOtherReason: DELETE_OTHER_REASON,
        createdAt: permitDeletedAt,
      })),
    );
  }

  console.info(
    `Test permit removed: permits ${permitIds.join(', ')} (newly deleted: ${
      activePermitIds.length
    }),`,
    counts,
  );

  await knex.raw('REFRESH MATERIALIZED VIEW public_permit_species');
  await knex.raw('REFRESH MATERIALIZED VIEW public_permits_by_cadastral_ids');
};

/**
 * Duomenų taisymas — atgal negrąžinamas.
 *
 * @returns { Promise<void> }
 */
exports.down = async function () {};

const TEST_PERMIT_NUMBER = 'Test Kristina';
// Išdavimo data 2025-11-04 Lietuvos laiku.
const TEST_PERMIT_ISSUE_DATE = '2025-11-03T22:00:00Z';
const DELETE_REASON = 'OTHER';
const DELETE_OTHER_REASON = 'Testinis leidimas (AAD sprendimas, #85 21 kl.)';
