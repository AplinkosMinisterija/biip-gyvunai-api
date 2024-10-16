'use strict';

import moleculer, { Context } from 'moleculer';
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
import { User } from './users.service';

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
  mixins: [
    DbConnection({
      collection: 'familyClassifiers',
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
      species: {
        type: 'array',
        virtual: true,
        readonly: true,
        default: (): any[] => [],
        async populate(ctx: Context, _values: any, families: User[]) {
          return await Promise.all(
            families.map(async (family) =>
              ctx.call('speciesClassifiers.find', {
                query: {
                  family: family.id,
                },
              }),
            ),
          );
        },
      },
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
      const found: number = await ctx.call('familyClassifiers.count', {
        query: { name, nameLatin },
      });
      if (found > 0) return `Name '${value}' is not available.`;
    }
    return true;
  }
  @Method
  async seedDB() {
    const data = [
      {
        name: 'Elniniai',
        nameLatin: 'Cervidae',
        species: [
          { name: 'Danielius', nameLatin: 'Dama dama' },
          { name: 'Danielius', nameLatin: 'Cervus dama' },
          { name: 'Taurieji elniai', nameLatin: 'Cervus elaphus' },
        ],
      },
      {
        name: 'Kabiauodegės beždžionės',
        nameLatin: 'Cebidae',
        species: [
          { name: 'Nykštukinė marmozetė', nameLatin: 'Callithrix (Cebuella) pygmaea' },
          { name: 'Paprastoji marmozetė', nameLatin: 'Callithrix pygmaea' },
          { name: 'Perukinė tamarina', nameLatin: 'Saguinus oedipus' },
          { name: 'Raudonrankė tamarina', nameLatin: 'Saguinus midas' },
          { name: 'Auksagalvė liūtbeždžionė', nameLatin: 'Leontopithecus chrysomelas' },
        ],
      },
      {
        name: 'Lemūriniai',
        nameLatin: 'Lemuridae',
        species: [{ name: 'Katinis lemūras', nameLatin: 'Lemur catta' }],
      },
      {
        name: 'Galaginiai',
        nameLatin: 'Galagidae',
        species: [{ name: 'Senegalinis galagas', nameLatin: 'Galago senegalensis' }],
      },
      {
        name: 'Katiniai',
        nameLatin: 'Felidae',
        species: [{ name: 'Liūtas', nameLatin: 'Panthera Leo' }],
      },
      {
        name: 'Šuninių ',
        nameLatin: 'Canidae',
        species: [{ name: 'Juodauodegis prerinis šuniukas', nameLatin: 'Cynomys ludovicianus' }],
      },
      {
        name: 'Voveriniai',
        nameLatin: 'Sciuridae',
        species: [{ name: 'Nykštukinė voverinė skraiduolė', nameLatin: 'Petaurus breviceps' }],
      },
      {
        name: 'Kupranugariniai',
        nameLatin: 'Camelidae',
        species: [{ name: 'Guanakas', nameLatin: 'Lama guanicoe' }],
      },
    ];
    for (const f of data) {
      const family = await this.createEntity(null, f);
      for (const s of f.species) {
        await this.broker.call('speciesClassifiers.create', { ...s, family: family.id });
      }
    }
    await this.createEntities(null, data);
  }
}
