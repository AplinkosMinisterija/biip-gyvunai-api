'use strict';

import { RestrictionType } from '@aplinkosministerija/moleculer-accounts';
import moleculer from 'moleculer';
import { Service } from 'moleculer-decorators';
import DbConnection from '../mixins/database.mixin';
import { Permit } from './permits.service';
import { PermitSpecies } from './permits.species.service';

export interface PublicPermitByCadastral {
  cadastral_number: string;
  permit_species: PermitSpecies[];
  permits: Permit[];
}

@Service({
  name: 'public.permitsByCadastralIds',

  mixins: [
    DbConnection({
      collection: 'publicPermitsByCadastralIds',
      createActions: {
        create: false,
        update: false,
        remove: false,
        createMany: false,
        removeAllEntities: false,
      },
    }),
  ],

  settings: {
    fields: {
      cadastralNumber: {
        type: 'string',
        primaryKey: true,
      },

      permits: {
        type: 'array',
        items: {
          type: 'object',
          props: {
            permitNumber: 'string',
            issuedToUser: {
              type: 'object',
              props: {
                firstName: 'string',
                lastName: 'string',
              },
            },
            issuedToTenant: {
              type: 'object',
              props: {
                name: 'string',
              },
            },
            id: 'number',
            permitSpecies: {
              type: 'array',
              columnType: 'jsonb',
              get: ({ entity }: any) => entity.permitSpecies || [],
            },
          },
        },
        columnType: 'jsonb',
        get: ({ entity }: any) => entity.permits || [],
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
export default class PublicPermitsByCadastralService extends moleculer.Service<PublicPermitByCadastral> {}
