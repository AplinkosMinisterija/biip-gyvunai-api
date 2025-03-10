exports.up = function (knex) {
  return knex.schema.alterTable('permits', (table) => {
    table.enu('deleteReason', [
      'NON_COMPLIANCE',
      'REQUESTED_CANCELLATION',
      'ENTITY_DISSOLVED',
      'HOLDER_DECEASED',
      'DISEASE_OUTBREAK',
      'NO_ANIMALS_FOR_YEAR',
      'INSUFFICIENT_SPACE',
      'NO_ANIMALS_INTRODUCED',
      'FRAUDULENT_INFO',
      'EXPIRED',
      'OTHER',
    ]);
    table.text('deleteOtherReason');
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('permits', (table) => {
    table.dropColumn('deleteReason');
    table.dropColumn('deleteOtherReason');
  });
};
