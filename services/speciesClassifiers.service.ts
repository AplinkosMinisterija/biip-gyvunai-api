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

export enum SpeciesType {
  PROTECTED = 'PROTECTED',
  INVASIVE = 'INVASIVE',
}

interface Fields extends CommonFields {
  id: number;
  name: string;
  nameLatin: string;
  type?: SpeciesType;
}

interface Populates extends CommonPopulates {}

export type SpeciesClassifier<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'speciesClassifiers',
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
      nameLatin: 'string|required',
      type: 'string',
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
export default class SpeciesClassifiersService extends moleculer.Service {
  @Method
  async seedDB() {
    const data = [
      { name: 'Danielius', nameLatin: 'Dama dama' },
      { name: 'Danielius', nameLatin: 'Cervus dama' },
      { name: 'Taurieji elniai', nameLatin: 'Cervus elaphus' },
      { name: 'Nykštukinė marmozetė', nameLatin: 'Callithrix (Cebuella) pygmaea' },
      { name: 'Paprastoji marmozetė', nameLatin: 'Callithrix pygmaea' },
      { name: 'Perukinė tamarina', nameLatin: 'Saguinus oedipus' },
      { name: 'Raudonrankė tamarina', nameLatin: 'Saguinus midas' },
      { name: 'Auksagalvė liūtbeždžionė', nameLatin: 'Leontopithecus chrysomelas' },
      { name: 'Katinis lemūras', nameLatin: 'Lemur catta' },
      { name: 'Senegalinis galagas', nameLatin: 'Galago senegalensis' },
      { name: 'Nykštukinė voverinė skraiduolė', nameLatin: 'Petaurus breviceps' },
      { name: 'Juodauodegis prerinis šuniukas', nameLatin: 'Cynomys ludovicianus' },
      { name: 'Liūtas', nameLatin: 'Panthera Leo' },
      { name: 'Guanakas', nameLatin: 'Lama guanicoe' },
    ];
    await this.createEntities(null, data);
  }
}
