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
  FieldHookCallback,
  RestrictionType,
  Table,
} from '../types';
import { FamilyClassifier } from './familyClassifiers.service';

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
  mixins: [
    DbConnection({
      collection: 'speciesClassifiers',
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
      nameLatin: {
        type: 'string',
        required: true,
        validate: 'validateLatinName',
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
    list: {
      auth: RestrictionType.PUBLIC,
    },
    find: {
      auth: RestrictionType.PUBLIC,
    },
    get: {
      auth: RestrictionType.PUBLIC,
    },
  },
})
export default class SpeciesClassifiersService extends moleculer.Service {
  @Method
  async validateLatinName({ ctx, value, operation, entity }: FieldHookCallback) {
    const name = ctx?.params?.name || entity?.name;
    const nameLatin = value;

    if (operation == 'create' || (entity && entity.nameLatin != value)) {
      const found: number = await ctx.call('speciesClassifiers.count', {
        query: { name, nameLatin },
      });
      if (found > 0) return `Name '${value}' is not available.`;
    }
    return true;
  }
}
