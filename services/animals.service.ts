'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';

import DbConnection from '../mixins/database.mixin';
import ProfileMixin from '../mixins/profile.mixin';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  CommonFields,
  CommonPopulates,
  FieldHookCallback,
  Gender,
  Table,
} from '../types';
import { AuthUserRole, UserAuthMeta } from './api.service';
import { Permit } from './permits.service';
import { Record, RecordType } from './records.service';
import { PossesionType, Species } from './species.service';
import { SpeciesClassifier } from './speciesClassifiers.service';
import { Tenant } from './tenants.service';
import { User } from './users.service';

interface Fields extends CommonFields {
  id: number;
  permit: Permit['id'];
  species: Species['id'];
  speciesClassifier: SpeciesClassifier['id'];
  gender: string;
  birthDate: string;
  certificate: string;
  tenant: Tenant['id'];
  user: User['id'];
  acquirementRecord: Record['id'];
  birthRecord: Record['id'];
  deathRecord: Record['id'];
  markingRecord: Record['id'];
  saleRecord: Record['id'];
}

interface Populates extends CommonPopulates {
  species: Species;
  permit: Permit;
  speciesClassifier: SpeciesClassifier;
  tenant: Tenant;
  user: User;
}

export type Animal<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'animals',
  mixins: [DbConnection(), ProfileMixin],
  settings: {
    fields: {
      id: {
        type: 'string',
        columnType: 'integer',
        primaryKey: true,
        secure: true,
      },
      species: {
        type: 'number',
        columnType: 'integer',
        columnName: 'speciesId',
        required: true,
        populate: {
          action: 'species.resolve',
        },
      },
      permit: {
        type: 'number',
        columnType: 'integer',
        columnName: 'permitId',
        populate: {
          action: 'permits.resolve',
        },
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
      certificate: 'string',
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
      acquirementRecord: {
        type: 'number',
        virtual: true,
        readonly: true,
        get({ entity, ctx }: FieldHookCallback) {
          return ctx.call('records.findOne', {
            query: {
              animal: entity.id,
              type: RecordType.ACQUIREMENT,
            },
          });
        },
      },
      birthRecord: {
        type: 'number',
        virtual: true,
        readonly: true,
        get({ entity, ctx }: FieldHookCallback) {
          return ctx.call('records.findOne', {
            query: {
              animal: entity.id,
              type: RecordType.BIRTH,
            },
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
              animal: entity.id,
              type: RecordType.DEATH,
            },
          });
        },
      },
      saleRecord: {
        type: 'number',
        virtual: true,
        readonly: true,
        get({ entity, ctx }: FieldHookCallback) {
          return ctx.call('records.findOne', {
            query: {
              animal: entity.id,
              type: RecordType.SALE,
            },
          });
        },
      },
      markingRecord: {
        type: 'number',
        virtual: true,
        readonly: true,
        get({ entity, ctx }: FieldHookCallback) {
          return ctx.call('records.findOne', {
            query: {
              animal: entity.id,
              type: RecordType.MARKING,
            },
            sort: '-createdAt',
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
  hooks: {
    before: {
      newAnimal: 'beforeCreate',
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
export default class AnimalsService extends moleculer.Service {
  @Action({
    rest: 'POST /',
    params: {
      species: 'number',
      gender: {
        type: 'string',
        enum: Object.values(Gender),
      },
      birthDate: 'string',
      certificate: 'string|optional',
      markingType: 'number|optional',
      markingNumber: 'string|optional',
      acquiredFrom: 'object|optional',
      acquireDate: 'string|optional',
    },
  })
  async newAnimal(ctx: Context<any>) {
    const animal = await this.createEntity(ctx);
    if (ctx.params.birthDate) {
      await ctx.call('records.newRecord', {
        type: RecordType.BIRTH,
        date: ctx.params.birthDate,
        numberOfAnimals: 1,
        animal: animal.id,
        species: animal.species,
        permit: animal.permit,
        user: animal.user,
        tenant: animal.tenant,
      });
    }
    if (ctx.params.acquiredFrom && ctx.params.acquireDate) {
      await ctx.call('records.newRecord', {
        type: RecordType.ACQUIREMENT,
        date: ctx.params.acquireDate,
        acquiredFrom: ctx.params.acquiredFrom,
        numberOfAnimals: 1,
        animal: animal.id,
        species: animal.species,
        permit: animal.permit,
        user: animal.user,
        tenant: animal.tenant,
        file: ctx.params.file,
      });
    }
    if (ctx.params.markingNumber && ctx.params.markingType) {
      await ctx.call('records.newRecord', {
        type: RecordType.MARKING,
        date: ctx.params.birthDate,
        numberOfAnimals: 1,
        markingNumber: ctx.params.markingNumber,
        markingType: ctx.params.markingType,
        animal: animal.id,
        species: animal.species,
        permit: animal.permit,
        user: animal.user,
        tenant: animal.tenant,
      });
    }
    return this.findEntity(ctx, { id: animal.id });
  }

  @Method
  async beforeCreate(ctx: Context<any, UserAuthMeta>) {
    const existingSpecies: Species<'permit'> = await ctx.call('species.findOne', {
      query: {
        id: ctx.params.species,
      },
      populate: 'permit',
    });

    if (!existingSpecies) {
      throw new moleculer.Errors.MoleculerClientError('Species not found', 422, 'INVALID_SPECIES');
    }

    const profile = ctx.meta.profile;
    const userId = ctx.meta.user.id;

    ctx.params.speciesClassifier = existingSpecies.speciesClassifier;
    ctx.params.permit = existingSpecies.permit?.id;
    ctx.params.user = existingSpecies.permit?.user;
    ctx.params.tenant = existingSpecies.permit?.tenant;

    if (
      ![AuthUserRole.ADMIN, AuthUserRole.SUPER_ADMIN].some(
        (role) => role === ctx.meta.authUser.type,
      )
    ) {
      const isTenantPermit = !!profile && existingSpecies.permit?.tenant == profile;
      const isUserPermit = !profile && existingSpecies.permit?.user == userId;
      if (
        !isTenantPermit &&
        !isUserPermit &&
        existingSpecies.possessionType === PossesionType.WITH_PERMIT
      ) {
        throw new moleculer.Errors.MoleculerClientError('Invalid permit', 422, 'INVALID_PERMIT');
      }
    }
    return ctx;
  }
}
