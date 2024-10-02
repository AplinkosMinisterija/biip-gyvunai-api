'use strict';

import moleculer, {Context} from 'moleculer';
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
  throwValidationError,
} from '../types';
import { UserAuthMeta } from "./api.service";

export enum SpeciesType {
  PROTECTED = 'PROTECTED',
  INVASIVE = 'INVASIVE',
}

interface Fields extends CommonFields {
  id: number;
  name: string;
  nameLatin: string;

}

interface Populates extends CommonPopulates {}

export type FamilyClassifier<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'familyClassifiers',
  mixins: [DbConnection({
    collection: 'familyClassifiers',
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
      nameLatin: 'string|required',
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },
  hooks: {
    before: {
      create: 'validateFamily',
      update: 'validateFamily',
    }
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
  async validateFamily(ctx: Context<{name: string, nameLatin: string}, UserAuthMeta>) {
    if(ctx.params.name === ctx.params.nameLatin) {
      throwValidationError('Name and latin name cannot not be the same.');
    }
  }
  @Method
  async seedDB() {
    const data = [
      { name: 'Arkliniai', nameLatin: 'Equidae' },
      { name: 'Elniniai', nameLatin: 'Cervidae' },
      { name: 'Kiauniniai', nameLatin: 'Mustelids' },
      { name: 'Kabiauodegės beždžionės', nameLatin: 'Cebidae' },
      { name: 'Lemūriniai', nameLatin: 'Lemuridae' },
      { name: 'Galaginiai', nameLatin: 'Galagidae' },
      { name: 'Sterbliniai', nameLatin: 'Marsupialia' },
      { name: 'Katiniai', nameLatin: 'Felidae' },
      { name: 'Šuninių ', nameLatin: 'Canidae' },
      { name: 'Voveriniai', nameLatin: 'Sciuridae' },
      { name: 'Kupranugariniai', nameLatin: 'Camelidae' }
    ];
    await this.createEntities(null, data);
  }
}
