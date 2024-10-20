'use strict';

import moleculer, { Context, RestSchema } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';

import Moleculer from 'moleculer';
import DbConnection from '../mixins/database.mixin';
import ProfileMixin from '../mixins/profile.mixin';
import UploadMixin from '../mixins/upload.mixin';
import {
  COMMON_ACTION_PARAMS,
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_PAGINATION_PARAMS,
  COMMON_SCOPES,
  CommonActionParams,
  CommonFields,
  CommonPopulates,
  FieldHookCallback,
  Gender,
  GroupByType,
  RestrictionType,
  Table,
  handleFormatResponse,
} from '../types';
import { AuthUserRole, UserAuthMeta } from './api.service';
import { Record, RecordType } from './records.service';
import { SpeciesClassifier } from './speciesClassifiers.service';
import { Tenant } from './tenants.service';
import { User } from './users.service';

interface Fields extends CommonFields {
  id: number;
  speciesClassifier: SpeciesClassifier['id'];
  gender: Gender;
  certificateNumber: string;
  address: string;
  municipality: any;
  tenant: Tenant['id'];
  user: User['id'];
  markingRecord?: Record['id'];
  obtainmentRecord?: Record['id'];
  pickUpFromNatureRecord?: Record['id'];
  releaseRecord?: Record['id'];
  transferRecord?: Record['id'];
  deathRecord?: Record['id'];
}

interface Populates extends CommonPopulates {
  speciesClassifier: SpeciesClassifier;
}

export type FosteredAnimal<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

interface FosteredAnimalsActionParams extends CommonActionParams {
  groupBy: keyof typeof GroupByType;
}

const FOSTERED_ANIMALS_ACTION_PARAMS = {
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

const FOSTERED_ANIMALS_ACTION_PAGINATION_PARAMS = {
  ...FOSTERED_ANIMALS_ACTION_PARAMS,
  ...COMMON_PAGINATION_PARAMS,
};

@Service({
  name: 'fosteredAnimals',
  mixins: [DbConnection(), ProfileMixin, UploadMixin],
  settings: {
    fields: {
      id: {
        type: 'string',
        columnType: 'integer',
        primaryKey: true,
        secure: true,
      },
      speciesClassifier: {
        type: 'number',
        columnType: 'integer',
        columnName: 'speciesClassifierId',
        populate: {
          action: 'speciesClassifiers.resolve',
        },
      },
      gender: {
        type: 'string',
        enum: Object.values(Gender),
      },
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
      markingRecord: {
        type: 'number',
        virtual: true,
        readonly: true,
        required: false,
        get({ entity, ctx }: FieldHookCallback) {
          return ctx.call('records.findOne', {
            query: {
              fosteredAnimalId: entity.id,
              type: RecordType.MARKING,
            },
            sort: '-createdAt',
          });
        },
      },
      obtainmentRecord: {
        type: 'number',
        virtual: true,
        readonly: true,
        required: false,
        get({ entity, ctx }: FieldHookCallback) {
          return ctx.call('records.findOne', {
            query: {
              fosteredAnimalId: entity.id,
              type: RecordType.OBTAINMENT_OF_FOSTERED_ANIMAL,
            },
            sort: '-createdAt',
          });
        },
      },
      pickUpFromNatureRecord: {
        type: 'number',
        virtual: true,
        readonly: true,
        required: false,
        get({ entity, ctx }: FieldHookCallback) {
          return ctx.call('records.findOne', {
            query: {
              fosteredAnimalId: entity.id,
              type: RecordType.PICK_UP_FROM_NATURE,
            },
            sort: '-createdAt',
          });
        },
      },
      deathRecord: {
        type: 'number',
        virtual: true,
        readonly: true,
        get({ entity, ctx }: FieldHookCallback) {
          return ctx.call('records.findOne', {
            query: {
              fosteredAnimalId: entity.id,
              type: RecordType.DEATH,
            },
          });
        },
      },
      releaseRecord: {
        type: 'number',
        virtual: true,
        readonly: true,
        get({ entity, ctx }: FieldHookCallback) {
          return ctx.call('records.findOne', {
            query: {
              fosteredAnimalId: entity.id,
              type: RecordType.RELEASE,
            },
          });
        },
      },
      transferRecord: {
        type: 'number',
        virtual: true,
        readonly: true,
        get({ entity, ctx }: FieldHookCallback) {
          return ctx.call('records.findOne', {
            query: {
              fosteredAnimalId: entity.id,
              type: RecordType.TRANSFER,
            },
          });
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
    create: {
      rest: null,
    },
  },
  hooks: {
    before: {
      newFosteredAnimal: 'beforeCreate',
      list: 'beforeSelect',
      find: 'beforeSelect',
      count: 'beforeSelect',
      get: 'beforeSelect',
      all: 'beforeSelect',
    },
  },
})
export default class FosteredAnimalsService extends moleculer.Service {
  @Action({
    rest: <RestSchema>{
      method: 'GET',
      basePath: '/public/fosteredAnimals',
      path: '/',
    },
    auth: RestrictionType.PUBLIC,
    params: FOSTERED_ANIMALS_ACTION_PAGINATION_PARAMS,
  })
  async publicFosteredAnimalsByMunicipality(ctx: Context<FosteredAnimalsActionParams>) {
    return await this.getPublicFosteredAnimalsByMunicipality(ctx);
  }

  @Action({
    rest: <RestSchema>{
      method: 'GET',
      basePath: '/public/fosteredAnimals',
      path: '/all',
    },
    auth: RestrictionType.PUBLIC,
    params: FOSTERED_ANIMALS_ACTION_PARAMS,
  })
  async publicFosteredAnimalsByMunicipalityAll(ctx: Context<FosteredAnimalsActionParams>) {
    return await this.getPublicFosteredAnimalsByMunicipality(ctx, true);
  }

  @Action({
    rest: 'POST /',
    params: {
      speciesClassifier: 'number|concert',
      gender: {
        type: 'string',
        enum: Object.values(Gender),
      },
      certificateNumber: 'string|optional',
      address: 'string',
      municipality: 'any',
      markingNumber: 'string|optional',
      markingType: 'number|convert|optional',
      acquireType: 'string',
      date: 'string',
      vetExaminationDate: 'string|optional',
      files: 'any',
    },
  })
  async newFosteredAnimal(ctx: Context<any>) {
    const fosteredAnimal = await this.createEntity(ctx);
    if (!fosteredAnimal) {
      throw new Moleculer.Errors.MoleculerClientError(
        'Could not create fostered animal',
        400,
        'UNABLE_TO_CREATE',
      );
    }

    if (!!ctx.params.markingNumber && !!ctx.params.markingType) {
      await ctx.call('records.newRecord', {
        type: RecordType.MARKING,
        numberOfAnimals: 1,
        fosteredAnimal: fosteredAnimal?.id,
        markingNumber: ctx.params.markingNumber,
        markingType: ctx.params.markingType,
      });
    }

    if (ctx.params.acquireType === 'ACQUIRED') {
      await ctx.call('records.newRecord', {
        type: RecordType.OBTAINMENT_OF_FOSTERED_ANIMAL,
        numberOfAnimals: 1,
        fosteredAnimal: fosteredAnimal.id,
        date: ctx.params.date,
        file: ctx.params.files,
      });
    }
    if (ctx.params.acquireType === 'FOUND') {
      await ctx.call('records.newRecord', {
        type: RecordType.PICK_UP_FROM_NATURE,
        numberOfAnimals: 1,
        fosteredAnimal: fosteredAnimal.id,
        date: ctx.params.date,
        vetExaminationDate: ctx.params.vetExaminationDate,
        file: ctx.params.files,
      });
    }
    return this.findEntity(ctx, { id: fosteredAnimal.id });
  }

  @Method
  async beforeCreate(ctx: Context<any, UserAuthMeta>) {
    const profile = ctx.meta.profile;
    const userId = ctx.meta.user.id;

    if (
      ![AuthUserRole.ADMIN, AuthUserRole.SUPER_ADMIN].some(
        (role) => role === ctx.meta.authUser.type,
      )
    ) {
      if (profile) {
        ctx.params.tenant = profile;
      } else {
        ctx.params.user = userId;
      }
    }
    return ctx;
  }

  @Method
  async getPublicFosteredAnimalsByMunicipality(
    ctx: Context<FosteredAnimalsActionParams>,
    all: boolean = false,
  ) {
    const fosteredAnimals: FosteredAnimal<'speciesClassifier'>[] = await ctx.call(
      'fosteredAnimals.find',
      {
        query: {
          speciesClassifier: { $exists: true },
        },
        populate: ['speciesClassifier'],
      },
    );

    const { groupBy } = ctx.params;
    const sort = ctx?.params?.sort;
    const page = ctx?.params?.page;
    const pageSize = ctx?.params?.pageSize;
    const search = ctx?.params?.search;
    const searchFields = ctx?.params?.searchFields;

    const isGroupByMunicipalityAndSpeciesClassifier =
      groupBy === GroupByType.MUNICIPALITY_AND_SPECIES_CLASSIFIER;

    const aggregateFosteredAnimalsInfo = (
      fosteredAnimal: { [key: string]: any },
      currentFosteredAnimal: FosteredAnimal<'speciesClassifier'>,
      groupByKey: string,
    ) => {
      // do not count if death or released
      const canIncreaseCount = !(
        currentFosteredAnimal?.deathRecord || currentFosteredAnimal?.releaseRecord
      );

      if (!isGroupByMunicipalityAndSpeciesClassifier && canIncreaseCount) {
        const { name, nameLatin, id, type } = currentFosteredAnimal.speciesClassifier;
        if (!fosteredAnimal[groupByKey].speciesClassifier[id]) {
          fosteredAnimal[groupByKey].speciesClassifier[id] = {
            name,
            nameLatin,
            id,
            type,
            count: 0,
          };
        }
        fosteredAnimal[groupByKey].speciesClassifier[id].count++;
      }

      if (canIncreaseCount) {
        fosteredAnimal[groupByKey].count++;
      }
    };

    const formattedFosteredAnimals = Object.values(
      fosteredAnimals.reduce((fosteredAnimal, currentFosteredAnimal) => {
        const municipality = currentFosteredAnimal.municipality;
        const { name, nameLatin, id, type } = currentFosteredAnimal.speciesClassifier;

        const groupByKey = isGroupByMunicipalityAndSpeciesClassifier
          ? `${municipality?.id}${name}`
          : `${municipality?.id}`;

        const speciesClassifier = isGroupByMunicipalityAndSpeciesClassifier
          ? { name, nameLatin, id, type }
          : {};

        if (!fosteredAnimal[groupByKey]) {
          fosteredAnimal[groupByKey] = {
            municipality,
            speciesClassifier,
            count: 0,
          };
        }
        aggregateFosteredAnimalsInfo(fosteredAnimal, currentFosteredAnimal, groupByKey);
        return fosteredAnimal;
      }, {} as { [key: string]: any }),
    ).map((fosteredAnimal) => ({
      ...fosteredAnimal,
      speciesClassifier: isGroupByMunicipalityAndSpeciesClassifier
        ? fosteredAnimal.speciesClassifier
        : Object.values(fosteredAnimal.speciesClassifier),
    }));

    return handleFormatResponse({
      data: formattedFosteredAnimals,
      search,
      searchFields,
      all,
      sort,
      page,
      pageSize,
    });
  }
}
