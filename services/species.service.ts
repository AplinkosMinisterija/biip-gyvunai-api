'use strict';

import moleculer, { Context, RestSchema } from 'moleculer';
import { Action, Event, Method, Service } from 'moleculer-decorators';

import { find } from 'lodash';
import DbConnection from '../mixins/database.mixin';
import ProfileMixin from '../mixins/profile.mixin';
import {
  COMMON_ACTION_PARAMS,
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_PAGINATION_PARAMS,
  COMMON_SCOPES,
  CommonActionParams,
  CommonFields,
  CommonPopulates,
  DeepQuery,
  EntityChangedParams,
  GroupByType,
  RestrictionType,
  Table,
  handleFormatResponse,
} from '../types';
import { Animal } from './animals.service';
import { AuthUserRole, UserAuthMeta } from './api.service';
import { Permit } from './permits.service';
import { Record, RecordType } from './records.service';
import { SpeciesClassifier } from './speciesClassifiers.service';
import { Tenant } from './tenants.service';
import { User } from './users.service';

export enum PossesionType {
  FOSTER = 'FOSTER',
  WITH_PERMIT = 'WITH_PERMIT',
}

export enum AccountingType {
  INDIVIDUAL = 'INDIVIDUAL',
  GROUP = 'GROUP',
}

export enum Units {
  UNIT = 'UNIT',
  KG = 'KG',
}

interface Fields extends CommonFields {
  id: number;
  permit: Permit['id'];
  speciesClassifier: SpeciesClassifier['id'];
  aviary: string;
  possessionType: PossesionType;
  type: AccountingType; //individual / group
  units: Units; // units / kg
  certificateNumber: string;
  address: string;
  municipality: {
    id: number;
    name: string;
  };
  tenant: Tenant['id'];
  user: User['id'];
  amount: number;
}

interface Populates extends CommonPopulates {
  permit: Permit;
  speciesClassifier: SpeciesClassifier;
  user: User;
  tenant: Tenant;
}

export type Species<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

interface SpeciesActionParams extends CommonActionParams {
  groupBy: keyof typeof GroupByType;
}

const SPECIES_ACTION_PARAMS = {
  groupBy: {
    type: 'string',
    default: GroupByType.MUNICIPALITY,
    enum: Object.values(GroupByType),
    optional: true,
  },
  search: {
    type: 'string',
    optional: true,
  },
  searchFields: {
    type: 'array',
    optional: true,
    items: {
      type: 'string',
    },
    default: ['municipality.name', 'speciesClassifier.name'],
  },
  ...COMMON_ACTION_PARAMS,
};

const SPECIES_ACTION_PAGINATION_PARAMS = {
  ...SPECIES_ACTION_PARAMS,
  ...COMMON_PAGINATION_PARAMS,
};

@Service({
  name: 'species',
  mixins: [DbConnection(), ProfileMixin],
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
        required: false,
        populate: {
          action: 'permits.resolve',
        },
      },
      speciesClassifier: {
        type: 'number',
        columnType: 'integer',
        columnName: 'speciesClassifierId',
        required: true,
        populate: {
          action: 'speciesClassifiers.resolve',
        },
      },
      aviary: 'string',
      possessionType: 'string|required', // foster, with permit
      type: 'string|required', //individual / group
      units: 'string', // units / kg
      certificateNumber: 'string',
      address: 'string',
      municipality: 'any',
      tenant: {
        type: 'number',
        columnType: 'integer',
        columnName: 'tenantId',
        populate: {
          action: 'tenants.resolve',
          params: {
            scope: false,
          },
        },
      },
      user: {
        type: 'number',
        columnType: 'integer',
        columnName: 'userId',
        populate: {
          action: 'users.resolve',
          params: {
            scope: false,
          },
        },
      },
      records: {
        virtual: true,
        deepQuery({ getService, q, serviceQuery, serviceFields, withQuery, deeper }: DeepQuery) {
          const subService = getService('records');

          const subQuery = serviceQuery(subService);
          subQuery.select(serviceFields(subService));
          withQuery(subQuery, 'id', 'species');
          // `created_at` is in default sort
          q.distinctOn(['created_at', 'id']).select('*');
          q.orderBy('id', 'asc');

          // Continue recursion
          deeper(subService);
        },
      },
      amount: 'number',
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
    defaultPopulates: [],
  },
  hooks: {
    before: {
      newSpecies: 'beforeCreate',
      list: 'beforeSelect',
      find: 'beforeSelect',
      count: 'beforeSelect',
      get: 'beforeSelect',
      all: 'beforeSelect',
    },
  },
  actions: {
    create: {
      rest: null,
    },
  },
})
export default class SpeciesService extends moleculer.Service {
  @Action({
    rest: <RestSchema>{
      method: 'GET',
      basePath: '/public/species',
      path: '/',
    },
    auth: RestrictionType.PUBLIC,
    params: SPECIES_ACTION_PAGINATION_PARAMS,
  })
  async publicSpeciesByMunicipality(ctx: Context<SpeciesActionParams>) {
    return await this.getPublicSpeciesByMunicipality(ctx);
  }

  @Action({
    rest: <RestSchema>{
      method: 'GET',
      basePath: '/public/species',
      path: '/all',
    },
    auth: RestrictionType.PUBLIC,
    params: SPECIES_ACTION_PARAMS,
  })
  async publicSpeciesByMunicipalityAll(ctx: Context<SpeciesActionParams>) {
    return await this.getPublicSpeciesByMunicipality(ctx, true);
  }

  @Action({
    rest: 'POST /',
    params: {
      permit: 'number|convert|optional',
      speciesClassifier: 'number',
      aviary: 'string|optional',
      possessionType: 'string', // foster, with permit
      type: 'string',
      units: 'string|optional',
      certificateNumber: 'string|optional',
      address: 'string|optional',
      municipality: 'any|optional',
      permitData: 'any|optional',
    },
  })
  async newSpecies(ctx: Context<any>) {
    if (ctx.params.type === PossesionType.WITH_PERMIT) {
      const permit: Permit = ctx.params.permitData;
      if (permit?.forest && !permit?.fencingOffDate) {
        throw new moleculer.Errors.MoleculerClientError(
          'No fencing off date',
          422,
          'NO_FENCING_OFF_DATE',
        );
      }
      const correctSpecies = find(
        permit.permitSpecies,
        (s) => s.id === ctx.params.speciesClassifier,
      );
      const otherSpecies = find(permit.permitSpecies, (s) => !s.id);
      if (!correctSpecies && !otherSpecies) {
        throw new moleculer.Errors.MoleculerClientError(
          'Incorrect species',
          422,
          'INCORRECT_SPECIES',
        );
      }
    }
    return this.createEntity(ctx);
  }

  @Method
  async beforeCreate(ctx: Context<any, UserAuthMeta>) {
    const profile = ctx.meta.profile;
    const userId = ctx.meta.user.id;
    if (ctx.params.type === PossesionType.WITH_PERMIT) {
      const existingPermit: Permit = await ctx.call('permits.findOne', {
        query: {
          id: ctx.params.permit,
        },
      });
      if (!existingPermit) {
        throw new moleculer.Errors.MoleculerClientError('Permit not found', 422, 'INVALID_PERMIT');
      }
      if (
        ![AuthUserRole.ADMIN, AuthUserRole.SUPER_ADMIN].some(
          (role) => role === ctx.meta.authUser.type,
        )
      ) {
        const isTenantPermit = !!profile && existingPermit.tenant == profile;
        const isUserPermit = !profile && existingPermit.user == userId;
        if (!isTenantPermit && !isUserPermit) {
          throw new moleculer.Errors.MoleculerClientError(`Invalid permit`, 422, 'INVALID_PERMIT');
        }
      }
      ctx.params.permitData = existingPermit;
    }
    ctx.params.tenant = profile;
    ctx.params.user = userId;
    return ctx;
  }

  @Method
  async getPublicSpeciesByMunicipality(ctx: Context<SpeciesActionParams>, all: boolean = false) {
    const species: Species<'speciesClassifier' | 'permit'>[] = await ctx.call('species.find', {
      query: {
        permit: { $exists: true },
        speciesClassifier: { $exists: true },
        amount: { $exists: true },
      },
      populate: ['speciesClassifier', 'permit'],
    });

    const { groupBy } = ctx.params;
    const sort = ctx?.params?.sort;
    const page = ctx?.params?.page;
    const pageSize = ctx?.params?.pageSize;
    const search = ctx?.params?.search;
    const searchFields = ctx?.params?.searchFields;

    const isGroupByMunicipalityAndSpeciesClassifier =
      groupBy === GroupByType.MUNICIPALITY_AND_SPECIES_CLASSIFIER;

    const aggregateSpeciesInfo = (
      species: { [key: string]: any },
      currentSpecies: Species<'speciesClassifier' | 'permit'>,
      groupByKey: string,
    ) => {
      if (!isGroupByMunicipalityAndSpeciesClassifier) {
        const { name, nameLatin, id, type } = currentSpecies.speciesClassifier;
        if (!species[groupByKey].speciesClassifier[id]) {
          species[groupByKey].speciesClassifier[id] = { name, nameLatin, id, type, count: 0 };
        }
        species[groupByKey].speciesClassifier[id].count += currentSpecies.amount;
      }

      species[groupByKey].permitsCount.push(currentSpecies.permit.id);
      species[groupByKey].count += currentSpecies.amount;
    };

    const formattedSpecies = Object.values(
      species.reduce((species, currentSpecies) => {
        const municipality = currentSpecies?.permit.municipality;
        const { name, nameLatin, id, type } = currentSpecies.speciesClassifier;

        const groupByKey = isGroupByMunicipalityAndSpeciesClassifier
          ? `${municipality?.id}${name}`
          : `${municipality?.id}`;

        const speciesClassifier = isGroupByMunicipalityAndSpeciesClassifier
          ? { name, nameLatin, id, type }
          : {};

        if (!species[groupByKey]) {
          species[groupByKey] = {
            municipality,
            speciesClassifier,
            permitsCount: [],
            count: 0,
          };
        }

        aggregateSpeciesInfo(species, currentSpecies, groupByKey);
        return species;
      }, {} as { [key: string]: any }),
    ).map((species) => ({
      ...species,
      speciesClassifier: isGroupByMunicipalityAndSpeciesClassifier
        ? species.speciesClassifier
        : Object.values(species.speciesClassifier),
      // get unique permit ids length
      permitsCount: [...new Set(species.permitsCount)].length,
    }));

    return handleFormatResponse({
      data: formattedSpecies,
      all,
      search,
      searchFields,
      sort,
      page,
      pageSize,
    });
  }
  @Event()
  async 'records.created'(ctx: Context<EntityChangedParams<Record>>) {
    const record = ctx.params.data as Record;
    const speciesId = record.species;
    const animaId = record.animal;
    if (speciesId) {
      const species: Species = await ctx.call('species.get', { id: speciesId });
      if (!species) {
        throw new moleculer.Errors.MoleculerClientError(
          'Incorrect species',
          422,
          'INCORRECT_SPECIES',
        );
      }
      let amount: number = 0;
      if (animaId && species.type === AccountingType.INDIVIDUAL) {
        const animal: Animal = await ctx.call('animals.get', { id: animaId });
        if (!animal) {
          throw new moleculer.Errors.MoleculerClientError(
            'Incorrect animal',
            422,
            'INCORRECT_ANIMAL',
          );
        }
        const animalsRegistered: Animal[] = await ctx.call('animals.find', {
          query: {
            species: speciesId,
          },
        });
        amount = animalsRegistered.length;
        for (const a of animalsRegistered) {
          if (!!a.saleRecord || !!a.deathRecord) {
            amount = amount - 1;
          }
        }
      } else if (speciesId && species.type === AccountingType.GROUP) {
        const records: Record[] =
          (await ctx.call('records.find', {
            query: {
              species: speciesId,
            },
          })) || [];
        for (const r of records) {
          if (
            [RecordType.BIRTH, RecordType.ACQUIREMENT].some((type: RecordType) => type === r.type)
          ) {
            amount += r.numberOfAnimals;
          }
          if ([RecordType.DEATH, RecordType.SALE].some((type: RecordType) => type === r.type)) {
            amount -= r.numberOfAnimals;
          }
        }
      }
      this.updateEntity(ctx, { id: speciesId, amount });
    }
  }
}
