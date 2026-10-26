'use strict';

import moleculer from 'moleculer';
import { Method, Service } from 'moleculer-decorators';

import DbConnection from '../mixins/database.mixin';
import { normalizeClassifierName, normalizedSql } from '../modules/permitValidation';
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
      name: {
        type: 'string',
        required: true,
      },
      nameLatin: {
        type: 'string',
        required: true,
        validate: 'validateUniqueLatinName',
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
  // AAD sprendimas (#85, 2 kl.): lotyniškas pavadinimas rūšių sąraše unikalus. Tikrinama tik
  // jį pakeitus, kad jau esami dublikatai (#85, 20 kl.) liktų redaguojami kitais laukais.
  @Method
  async validateUniqueLatinName({ ctx, value, operation, entity }: FieldHookCallback) {
    if (!value) return true;

    const isChanged =
      operation === 'create' ||
      normalizeClassifierName(value) !== normalizeClassifierName(entity?.nameLatin);

    if (!isChanged) return true;

    // Lyginama be didžiųjų raidžių ir tarpų skirtumų, kad „Dama dama“ ir „dama  dama “ nesidubliuotų.
    const adapter = await this.getAdapter(ctx);
    const duplicate = await adapter
      .client('speciesClassifiers')
      .whereNull('deletedAt')
      .whereRaw(`${normalizedSql('name_latin')} = ${normalizedSql('?')}`, [value])
      .modify((query: any) => entity?.id && query.whereNot('id', entity.id))
      .first('id');

    if (duplicate) return `Name '${value}' is not available.`;

    return true;
  }
}
