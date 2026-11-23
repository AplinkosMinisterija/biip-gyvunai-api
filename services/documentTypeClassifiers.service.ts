'use strict';

import moleculer from 'moleculer';
import { Service } from 'moleculer-decorators';

import DbConnection from '../mixins/database.mixin';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  CommonFields,
  CommonPopulates,
  RestrictionType,
  Table,
} from '../types';

interface Fields extends CommonFields {
  id: number;
  name: string;
}

interface Populates extends CommonPopulates {}

export type DocumentTypeClassifier<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

// AAD sprendimas (#85, 10 kl. b): žurnalo įrašų dokumentų tipų sąrašą tvarko AAD
// administravimo aplinkoje. Pradinis sąrašas įrašomas migracija.
@Service({
  name: 'documentTypeClassifiers',
  mixins: [
    DbConnection({
      collection: 'documentTypeClassifiers',
    }),
  ],
  settings: {
    fields: {
      id: {
        type: 'string',
        columnType: 'integer',
        primaryKey: true,
        secure: true,
      },
      name: 'string|required',
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },
  actions: {
    create: {
      auth: RestrictionType.ADMIN,
    },
    update: {
      auth: RestrictionType.ADMIN,
    },
    remove: {
      auth: RestrictionType.ADMIN,
    },
    list: {
      auth: RestrictionType.PUBLIC,
    },
    find: {
      auth: RestrictionType.PUBLIC,
    },
  },
})
export default class DocumentTypeClassifiersService extends moleculer.Service {}
