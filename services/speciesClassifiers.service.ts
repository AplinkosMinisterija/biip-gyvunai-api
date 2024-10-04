'use strict';

import moleculer from 'moleculer';
import { Method, Service } from 'moleculer-decorators';

import DbConnection from '../mixins/database.mixin';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  CommonFields,
  CommonPopulates, FieldHookCallback,
  RestrictionType,
  Table,
} from '../types';
import {FamilyClassifier} from "./familyClassifiers.service";

export enum SpeciesType {
  PROTECTED = 'PROTECTED',
  INVASIVE = 'INVASIVE',
}

interface Fields extends CommonFields {
  id: number;
  name: string;
  nameLatin: string;
  family: FamilyClassifier['id'];
  type?: SpeciesType;
}

interface Populates extends CommonPopulates {
  family: FamilyClassifier;
}

export type SpeciesClassifier<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'speciesClassifiers',
  mixins: [DbConnection({
    collection: 'speciesClassifiers',
  })],
  settings: {
    fields: {
      id: {
        type: 'string',
        columnType: 'integer',
        primaryKey: true,
        secure: true,
      },
      name: 'string|required',
      nameLatin: {
        type: 'string',
        required: true,
        validate: 'validateLatinName'
      },
      family: {
        type: 'number',
        columnType: 'integer',
        columnName: 'familyClassifierId',
        required: true,
        populate: {
          action: 'familyClassifiers.resolve',
          params: {
            scope: false,
          },
        },
      },
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
    get: {
      auth: RestrictionType.PUBLIC,
    }
  },
})
export default class SpeciesClassifiersService extends moleculer.Service {

  @Method
  async validateLatinName({ ctx, value, entity }: FieldHookCallback) {
    const name = ctx?.params?.name || entity?.name;
    if(name && name.trim() === value.trim()) {
      return'Latin name should not be the same as name';
    }
    return true;
  }

  @Method
  async seedDB() {
    await this.broker.waitForServices(['familyClassifiers']);
    const data = [
      { name: 'Danielius', nameLatin: 'Dama dama', family:  2},
      { name: 'Danielius', nameLatin: 'Cervus dama', family: 2},
      { name: 'Taurieji elniai', nameLatin: 'Cervus elaphus', family: 2 },
      { name: 'Nykštukinė marmozetė', nameLatin: 'Callithrix (Cebuella) pygmaea', family: 4 },
      { name: 'Paprastoji marmozetė', nameLatin: 'Callithrix pygmaea', family: 4 },
      { name: 'Perukinė tamarina', nameLatin: 'Saguinus oedipus', family: 4 },
      { name: 'Raudonrankė tamarina', nameLatin: 'Saguinus midas', family: 4 },
      { name: 'Auksagalvė liūtbeždžionė', nameLatin: 'Leontopithecus chrysomelas', family: 4 },
      { name: 'Katinis lemūras', nameLatin: 'Lemur catta', family: 5 },
      { name: 'Senegalinis galagas', nameLatin: 'Galago senegalensis', family: 6 },
      { name: 'Nykštukinė voverinė skraiduolė', nameLatin: 'Petaurus breviceps', family:7 },
      { name: 'Juodauodegis prerinis šuniukas', nameLatin: 'Cynomys ludovicianus', family: 10 },
      { name: 'Liūtas', nameLatin: 'Panthera Leo', family: 9 },
      { name: 'Guanakas', nameLatin: 'Lama guanicoe', family: 11 },
    ];
    await this.createEntities(null, data);
  }
}
