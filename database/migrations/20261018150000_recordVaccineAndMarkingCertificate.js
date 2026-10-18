/**
 * AAD sprendimai (#85):
 * - 13 kl.: vakcinos pavadinimas išsaugomas (forma jį prašė įvesti, bet stulpelio nebuvo).
 * - 12 kl.: kiekvienas ženklinimo įrašas turi savo ženklinimo pažymos numerį.
 * Abu laukai neprivalomi.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('records', (table) => {
    table.string('vaccineName');
    table.string('markingCertificateNo');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('records', (table) => {
    table.dropColumn('vaccineName');
    table.dropColumn('markingCertificateNo');
  });
};
