'use strict';

import moleculer, { Context, RestSchema } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';

import { find } from 'lodash';
import DbConnection from '../mixins/database.mixin';
import ProfileMixin from '../mixins/profile.mixin';
import {
  OUTGOING_RECORD_TYPES,
  calculateGroupAmount,
  calculateIndividualAmount,
} from '../modules/speciesAmount';
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
  GroupByType,
  RestrictionType,
  Table,
  handleFormatResponse,
  isAdmin,
} from '../types';
import { Animal } from './animals.service';
import { UserAuthMeta } from './api.service';
import { Permit } from './permits.service';
import { Record } from './records.service';
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
        deepQuery: 'speciesClassifiers',
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
          // LEFT JOIN records ON species.id = records.species
          const subService = getService('records');
          const subQuery = serviceQuery(subService);
          subQuery.select(serviceFields(subService));
          withQuery(subQuery, 'id', 'species');

          // Continue recursion
          deeper(subService);

          const isCountQuery =
            q._statements.find((stmt: any) => stmt.grouping === 'columns')?.method === 'count';

          if (isCountQuery) {
            q.clear('select');
            q.countDistinct('id');
          } else {
            // To make distinct after left join - clone exsiting, clear everything, and wrap it, group it, distinct it
            const clone = q.clone();
            [
              'select',
              'columns',
              'with',
              'select',
              'columns',
              'where',
              'union',
              'join',
              'group',
              'order',
              'having',
              'limit',
              'offset',
              'counter',
              'counters',
            ].forEach((key) => {
              q.clear(key);
            });

            q.distinctOn('id').from(clone.as('subQuery')).orderBy('id', 'asc');
          }
        },
      },
      amount: 'number',
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
    // Laukai, kurių apribotas naudotojas keisti negali (žr. ProfileMixin.beforeMutate).
    userImmutableFields: ['permit', 'amount', 'type', 'possessionType'],
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
      update: 'beforeMutate',
      replace: 'beforeMutate',
      remove: 'beforeMutate',
    },
  },
  actions: {
    create: {
      rest: null,
      visibility: 'public',
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
    if (ctx.params.possessionType === PossesionType.WITH_PERMIT) {
      if (!ctx.params.permit) {
        throw new moleculer.Errors.MoleculerClientError(
          'Permit is required',
          422,
          'INVALID_PERMIT',
        );
      }
      const existingPermit: Permit = await ctx.call('permits.findOne', {
        query: {
          id: ctx.params.permit,
        },
      });
      if (!existingPermit) {
        throw new moleculer.Errors.MoleculerClientError('Permit not found', 422, 'INVALID_PERMIT');
      }
      if (!isAdmin(ctx)) {
        const isTenantPermit = !!profile && Number(existingPermit.tenant) === Number(profile);
        const isUserPermit = !profile && (existingPermit.users ?? []).includes(userId);
        if (!isTenantPermit && !isUserPermit) {
          throw new moleculer.Errors.MoleculerClientError('Invalid permit', 422, 'INVALID_PERMIT');
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
  // Vidinis veiksmas (ne HTTP): kviečiamas iš records/animals hook'ų po kiekvieno pakeitimo.
  @Action({
    visibility: 'public',
    params: {
      id: 'number|convert',
    },
  })
  async recalculateAmount(ctx: Context<{ id: number }>) {
    const species: Species = await this.resolveEntities(ctx, { id: ctx.params.id });
    if (!species) return null;

    const amount =
      species.type === AccountingType.INDIVIDUAL
        ? await this.countIndividualAnimals(species.id)
        : await this.sumGroupRecords(species.id);

    return this.updateEntity(ctx, { id: species.id, amount });
  }

  // Skaičiuojama be naudotojo konteksto (`this.broker.call`), kad ProfileMixin
  // neapribotų įrašų iki kuriančio naudotojo — leidimu dalijasi keli naudotojai.
  @Method
  async sumGroupRecords(speciesId: number): Promise<number> {
    const records: Pick<Record, 'type' | 'numberOfAnimals'>[] = await this.broker.call(
      'records.find',
      { query: { species: speciesId }, fields: ['type', 'numberOfAnimals'] },
    );

    return calculateGroupAmount(records);
  }

  @Method
  async countIndividualAnimals(speciesId: number): Promise<number> {
    const animals: Pick<Animal, 'id'>[] = await this.broker.call('animals.find', {
      query: { species: speciesId },
      fields: ['id'],
    });
    const animalIds = animals.map((animal) => animal.id);
    if (!animalIds.length) return 0;

    // Gyvūno įrašai ne visada turi `species`, todėl mažinantys įrašai ieškomi pagal gyvūną.
    const outgoingRecords: Pick<Record, 'animal'>[] = await this.broker.call('records.find', {
      query: { animal: { $in: animalIds }, type: { $in: OUTGOING_RECORD_TYPES } },
      fields: ['animal'],
    });

    return calculateIndividualAmount(animalIds, outgoingRecords);
  }
}
