/**
 * AAD sprendimas (#85, 6 kl.): panaikintą leidimą atstatant istorijoje fiksuojama, kas, kada ir
 * dėl kokios priežasties jį atstatė. Prie istorijos tipų pridedamas RESTORED ir stulpelis
 * atstatymo priežasčiai (naikinimo priežasčių sąrašas atstatymui netinka).
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await replaceTypeCheck(knex, ['CREATED', 'UPDATED', 'DELETED', 'RESTORED']);
  await knex.schema.alterTable('permitHistories', (table) => {
    table.text('restoreReason');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex('permitHistories').where({ type: 'RESTORED' }).delete();
  await knex.schema.alterTable('permitHistories', (table) => {
    table.dropColumn('restoreReason');
  });
  await replaceTypeCheck(knex, ['CREATED', 'UPDATED', 'DELETED']);
};

// `table.enu` sukurtas CHECK apribojimas ieškomas pagal apibrėžimą, o ne pagal numanomą vardą.
async function replaceTypeCheck(knex, types) {
  const { rows } = await knex.raw(`
    SELECT conname AS name FROM pg_constraint
    WHERE conrelid = 'permit_histories'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%type%'
      AND pg_get_constraintdef(oid) NOT LIKE '%delete_reason%'
  `);

  for (const { name } of rows) {
    await knex.raw('ALTER TABLE permit_histories DROP CONSTRAINT ??', [name]);
  }

  // DDL parametrų nepriima; reikšmės — konstantos iš šio failo.
  const allowed = types.map((type) => `'${type}'`).join(', ');
  await knex.raw(
    `ALTER TABLE permit_histories ADD CONSTRAINT permit_histories_type_check CHECK (type IN (${allowed}))`,
  );
}
