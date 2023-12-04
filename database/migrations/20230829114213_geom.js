exports.up = function (knex) {
  return knex.schema
    .raw(`CREATE EXTENSION IF NOT EXISTS postgis;`)
    .raw(`ALTER TABLE permits ADD COLUMN geom geometry(point, 3346)`)
    .raw(`CREATE INDEX permits_geom_idx ON permits USING GIST (geom)`);
};

exports.down = function (knex) {
  return knex.schema.alterTable('permits', (table) => {
    table.dropColumn('geom');
  });
};
