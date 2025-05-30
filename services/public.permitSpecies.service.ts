'use strict';

import { RestrictionType } from '@aplinkosministerija/moleculer-accounts';
import moleculer, { Context } from 'moleculer';
import { Event, Method, Service } from 'moleculer-decorators';
import DbConnection, { MaterializedView } from '../mixins/database.mixin';

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
  name: 'public.permitSpecies',

  mixins: [
    DbConnection({
      collection: 'publicPermitSpecies',
      createActions: {
        create: false,
        update: false,
        remove: false,
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
        primaryKey: true,
      },
      species: {
        type: 'string',
      },
      speciesLot: {
        type: 'string',
      },
      totalPermits: {
        type: 'number',
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
  actions: {
    list: {
      auth: RestrictionType.PUBLIC,
    },
    find: {
      auth: RestrictionType.PUBLIC,
    },
    get: {
      auth: RestrictionType.PUBLIC,
    },
    count: {
      auth: RestrictionType.PUBLIC,
    },
  },
})
export default class PublicPermitSpeciesStatsService extends moleculer.Service<PublicPermitSpeciesStat> {
  @Event()
  async 'permits.*'(ctx: Context<any>) {
    await this.handlePermitEvent(ctx);
  }

  @Event()
  async 'permits.species.*'(ctx: Context<any>) {
    await this.handlePermitEvent(ctx);
  }
  @Method
  async handlePermitEvent(ctx: Context<any>) {
    const type = ctx?.params?.type;

    if (['create', 'update', 'replace', 'remove'].includes(type)) {
      await this.refreshMaterializedView(ctx, MaterializedView.PUBLIC_PERMIT_SPECIES);
    }
  }
}
