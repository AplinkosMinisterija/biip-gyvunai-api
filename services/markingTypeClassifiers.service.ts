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
}

interface Populates extends CommonPopulates {}

export type MarkingTypeClassifier<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'markingTypeClassifiers',
  mixins: [
    DbConnection({
      collection: 'phylums',
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
export default class MarkingTypeClassifiersService extends moleculer.Service {
  @Method
  async seedDB() {
    const data = [
      { name: 'metalinis žiedas' },
      { name: 'plastikinis žiedas' },
      { name: 'įvairių konstrukcijų prie kūno tvirtinamais ženklais' },
      { name: 'dažymas specialiais dažais' },
      { name: 'tatuiravimas' },
      { name: 'atskirų kūno dalių ar plunksnų iškarpymas' },
      { name: 'žymių padarymas kūne' },
      { name: 'mikroschemos po oda įvedimas' },
      { name: 'radijo siųstuvo pritvirtinimas' },
    ];
    await this.createEntities(null, data);
  }
}
