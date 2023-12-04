'use strict';

import moleculer from 'moleculer';
import { Method, Service } from 'moleculer-decorators';

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
  nameShort: string;
}

interface Populates extends CommonPopulates {}

export type IssuerClassifier<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'issuerClassifiers',
  mixins: [DbConnection()],
  settings: {
    fields: {
      id: {
        type: 'string',
        columnType: 'integer',
        primaryKey: true,
        secure: true,
      },
      name: 'string|required',
      nameShort: 'string|required',
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
export default class IssuerClassifiersService extends moleculer.Service {
  @Method
  async seedDB() {
    const data = [
      { name: 'Aplinkos apsaugos agentūra', nameShort: 'AAA' },
      { name: 'Alytaus RAAD', nameShort: 'RAAD' },
      { name: 'Kauno RAAD', nameShort: 'RAAD' },
      { name: 'Klaipėdos RAAD', nameShort: 'RAAD' },
      { name: 'Marijampolės RAAD', nameShort: 'RAAD' },
      { name: 'Panevėžio RAAD', nameShort: 'RAAD' },
      { name: 'Šiaulių RAAD', nameShort: 'RAAD' },
      { name: 'Utenos RAAD', nameShort: 'RAAD' },
      { name: 'Vilniaus RAAD', nameShort: 'RAAD' },
    ];
    await this.createEntities(null, data);
  }
}
