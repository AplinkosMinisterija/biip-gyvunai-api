/**
 * Perskaičiuoja visų rūšių `amount`: grupinei apskaitai — iš visų nepašalintų įrašų,
 * individualiai — iš gyvų gyvūnų be mažinančio įrašo (DEATH/SALE/TRANSFER/RELEASE).
 *
 * Iki šiol skaičius buvo atnaujinamas tik kuriant įrašą, matant vien kuriančio naudotojo
 * įrašus, neįskaitant TRANSFER/RELEASE ir neperskaičiuojant po pakeitimų ar trynimų, todėl
 * istorinės reikšmės neteisingos. Rūšys, niekada neturėjusios įrašų ar gyvūnų, neliečiamos
 * (jų NULL laiko jas už viešos statistikos ribų); rūšys, kurių visi įrašai pašalinti, gauna 0.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.raw(`
    UPDATE species s
    SET amount = COALESCE(r.total, 0)
    FROM (
      SELECT species_id,
             SUM(CASE
                   WHEN type IN ('ACQUIREMENT', 'BIRTH') THEN COALESCE(number_of_animals, 0)
                   WHEN type IN ('DEATH', 'SALE', 'TRANSFER', 'RELEASE') THEN -COALESCE(number_of_animals, 0)
                   ELSE 0
                 END) FILTER (WHERE deleted_at IS NULL) AS total
      FROM records
      WHERE species_id IS NOT NULL
      GROUP BY species_id
    ) r
    WHERE r.species_id = s.id
      AND s.deleted_at IS NULL
      AND s.type IS DISTINCT FROM 'INDIVIDUAL'
  `);

  await knex.raw(`
    UPDATE species s
    SET amount = live.count
    FROM (
      SELECT an.species_id,
             COUNT(*) FILTER (
               WHERE an.deleted_at IS NULL
                 AND NOT EXISTS (
                   SELECT 1
                   FROM records r
                   WHERE r.animal_id = an.id
                     AND r.deleted_at IS NULL
                     AND r.type IN ('DEATH', 'SALE', 'TRANSFER', 'RELEASE')
                 )
             ) AS count
      FROM animals an
      WHERE an.species_id IS NOT NULL
      GROUP BY an.species_id
    ) live
    WHERE live.species_id = s.id
      AND s.deleted_at IS NULL
      AND s.type = 'INDIVIDUAL'
  `);
};

/**
 * Ankstesnių reikšmių atkurti neįmanoma — perskaičiavimas negrįžtamas.
 *
 * @returns { Promise<void> }
 */
exports.down = function () {
  return Promise.resolve();
};
