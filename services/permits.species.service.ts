'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';

import DbConnection from '../mixins/database.mixin';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  CommonFields,
  CommonPopulates,
  Table,
} from '../types';
import { FamilyClassifier } from './familyClassifiers.service';
import { SpeciesClassifier } from './speciesClassifiers.service';

interface Fields extends CommonFields {
  id: number;
  species: SpeciesClassifier['id'];
  family: FamilyClassifier['id'];
}

interface Populates extends CommonPopulates {
  family: FamilyClassifier;
  species: SpeciesClassifier;
}

export type PermitSpecies<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'permits.species',
  mixins: [
    DbConnection({
      collection: 'permitSpecies',
      rest: false,
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
      permit: {
        type: 'number',
        columnType: 'integer',
        columnName: 'permitId',
        populate: 'permits.resolve',
      },
      species: {
        type: 'number',
        columnType: 'integer',
        columnName: 'speciesClassifierId',
        populate: 'speciesClassifiers.resolve',
      },
      family: {
        type: 'number',
        columnType: 'integer',
        columnName: 'familyClassifierId',
        required: true,
        populate: 'familyClassifiers.resolve',
      },
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },
})
export default class PermitSpeciesService extends moleculer.Service {
  @Action()
  async createOrUpdate(ctx: Context<{ id: number; species: number; family: number }>) {
    const { family, species } = ctx.params;
    let { id } = ctx.params;
    if (family) {
      const permitSpecies: PermitSpecies = await ctx.call('permits.species.findOne', {
        query: {
          family,
          species,
        },
      });

      id = permitSpecies?.id;
    }

    if (!id) {
      return ctx.call('permits.species.create', ctx.params);
    }

    return ctx.call('permits.species.update', { ...ctx.params, id });
  }
}
