'use strict';

import moleculer from 'moleculer';
import { Service } from 'moleculer-decorators';
import DbConnection from '../mixins/database.mixin';

export interface Municipality {
  id: string;
  name: string;
}

export interface PublicPermitSpeciesStat {
  speciesId: number;
  species: string;
  specieLot: string;
  totalPermits: number;
  municipalities: Municipality[];
}

@Service({
  name: 'publicPermitSpecies',

  mixins: [
    DbConnection({
      collection: 'publicPermitSpecies',
      createActions: {
        create: false,
        update: false,
        remove: false,
        get: false,
        createMany: false,
        removeAllEntities: false,
      },
    }),
  ],

  createActions: false,

  settings: {
    fields: {
      speciesId: {
        type: 'number',
        columnName: 'species_id',
        primaryKey: true,
      },
      species: {
        type: 'string',
        columnName: 'species',
      },
      specieLot: {
        type: 'string',
        columnName: 'specie_lot',
      },
      totalPermits: {
        type: 'number',
        columnName: 'total_permits',
      },
      municipalities: {
        type: 'array',
        items: {
          type: 'object',
          props: {
            id: 'string',
            name: 'string',
          },
        },
        columnType: 'jsonb',
        get: ({ entity }: any) => entity.municipalities || [],
      },
    },
  },
})
export default class PublicPermitSpeciesStatsService extends moleculer.Service<PublicPermitSpeciesStat> {}
