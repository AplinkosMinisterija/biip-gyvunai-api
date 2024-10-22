'use strict';

import moleculer, { Context, RestSchema } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';

import ApiGateway from 'moleculer-web';
import DbConnection from '../mixins/database.mixin';
import ProfileMixin from '../mixins/profile.mixin';
import UploadMixin from '../mixins/upload.mixin';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  CommonFields,
  CommonPopulates,
  Gender,
  MultipartMeta,
  Table,
} from '../types';
import { Animal } from './animals.service';
import { AuthUserRole, UserAuthMeta } from './api.service';
import { FosteredAnimal } from './fosteredAnimals.service';
import { MarkingTypeClassifier } from './markingTypeClassifiers.service';
import { Permit } from './permits.service';
import { Species } from './species.service';
import { SpeciesClassifier } from './speciesClassifiers.service';
import { Tenant } from './tenants.service';
import { User } from './users.service';

export enum RecordType {
  ACQUIREMENT = 'ACQUIREMENT',
  BIRTH = 'BIRTH',
  DEATH = 'DEATH',
  VACCINATION = 'VACCINATION',
  SALE = 'SALE',
  TREATMENT = 'TREATMENT',
  MARKING = 'MARKING',
  PICK_UP_FROM_NATURE = 'PICK_UP_FROM_NATURE',
  OBTAINMENT_OF_FOSTERED_ANIMAL = 'OBTAINMENT_OF_FOSTERED_ANIMAL',
  RELEASE = 'RELEASE',
  TRANSFER = 'TRANSFER',
  GENDER_CONFIRMATION = 'GENDER_CONFIRMATION',
}

export enum DeathReason {
  EUTHANIZED = 'EUTHANIZED',
  FOUND_DEAD = 'FOUND_DEAD',
}

export enum LegalForm {
  LEGAL_ENTITY = 'LEGAL_ENTITY',
  INDIVIDUAL = 'INDIVIDUAL',
}

export enum NationalityType {
  LOCAL = 'LOCAL',
  FOREIGN = 'FOREIGN',
}

const recordPropertyNames: { [key: string]: string } = {
  [RecordType.BIRTH]: 'birthRecord',
  [RecordType.DEATH]: 'deathRecord',
  [RecordType.SALE]: 'saleRecord',
  [RecordType.ACQUIREMENT]: 'acquirementRecord',
};

interface Fields extends CommonFields {
  id: number;
  animal: Animal['id'];
  permit: Permit['id'];
  species: Species['id'];
  fosteredAnimal: FosteredAnimal['id'];
  speciesClassifier: SpeciesClassifier['id'];
  type: RecordType;
  date: string;
  numberOfAnimals: number;
  note: string;
  deathReason: DeathReason;
  markingNumber: string;
  markingType: MarkingTypeClassifier['id'];
  file: any;
  acquiredFrom: {
    type: LegalForm;
    nationalityType: NationalityType;
    name: string;
    code?: string;
    address?: string;
    permitNumber?: string;
    permitIssueDate?: string;
    permitIssuer?: string;
  };
  acquireDate: string;
  vetExaminationDate: string;
  municipality: any;
  transferRecipient: {
    type: LegalForm;
    address: string;
    phone: string;
    email: string;
  };
  tenant: Tenant['id'];
  user: User['id'];
}

interface Populates extends CommonPopulates {
  speciesClassifier: SpeciesClassifier;
  species: Species;
  permits: Permit;
  user: User;
  tenant: Tenant;
  markingType: MarkingTypeClassifier;
}

export type Record<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'records',
  mixins: [DbConnection(), ProfileMixin, UploadMixin],
  settings: {
    fields: {
      id: {
        type: 'string',
        columnType: 'integer',
        primaryKey: true,
        secure: true,
      },
      animal: {
        type: 'number',
        convert: true,
        columnType: 'integer',
        columnName: 'animalId',
        required: false,
        populate: {
          action: 'animals.resolve',
        },
      },
      permit: {
        type: 'number',
        convert: true,
        columnType: 'integer',
        columnName: 'permitId',
        required: false,
        populate: {
          action: 'permits.resolve',
        },
      },
      species: {
        type: 'number',
        convert: true,
        columnType: 'integer',
        columnName: 'speciesId',
        required: false,
        populate: {
          action: 'species.resolve',
        },
      },
      fosteredAnimal: {
        type: 'number',
        columnType: 'integer',
        columnName: 'fosteredAnimalId',
        required: false,
        populate: {
          action: 'fosteredAnimals.resolve',
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
      type: {
        type: 'string',
        required: true,
        enum: Object.values(RecordType),
      },
      gender: {
        type: 'string',
        enum: [Gender.FEMALE, Gender.FEMALE, Gender.UNIDENTIFIED],
      },
      date: 'string',
      numberOfAnimals: 'number',
      note: 'string',
      deathReason: 'string',
      markingNumber: 'string',
      markingType: {
        type: 'number',
        columnType: 'integer',
        columnName: 'markingTypeId',
        populate: {
          action: 'markingTypeClassifiers.resolve',
        },
      },
      file: 'array',
      acquiredFrom: {
        type: 'object',
        raw: true,
        required: false,
        properties: {
          type: 'string',
          nationalityType: 'string',
          name: 'string',
          code: 'string',
          address: 'string',
          permitNumber: 'string',
          permitIssueDate: 'string',
          permitIssuer: 'string',
        },
      },
      acquireDate: 'string',
      vetExaminationDate: 'string',
      municipality: 'object',
      transferRecipient: 'object',
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
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
    defaultPopulates: ['markingType'],
  },
  hooks: {
    before: {
      newRecord: ['beforeCreate'],
      list: ['beforeSelect', 'handleFilters'],
      find: ['beforeSelect', 'handleFilters'],
      count: ['beforeSelect', 'handleFilters'],
      get: ['beforeSelect', 'handleFilters'],
      all: ['beforeSelect', 'handleFilters'],
    },
    after: {
      create: ['afterCreate'],
    },
  },
  actions: {
    create: {
      rest: null,
    },
  },
})
export default class RecordsService extends moleculer.Service {
  @Action({
    rest: 'POST /',
    params: {
      animal: 'number|convert|optional',
      species: 'number|convert|optional',
      fosteredAnimal: 'number|convert|optional',
      type: {
        type: 'string',
        enum: Object.values(RecordType),
      },
      gender: {
        type: 'string',
        enum: [Gender.FEMALE, Gender.FEMALE, Gender.UNIDENTIFIED],
        required: false,
      },
      date: 'string|optional',
      numberOfAnimals: 'number|convert|optional',
      note: 'string|optional',
      deathReason: 'string|optional',
      acquiredFrom: 'object|optional',
      acquireDate: 'string|optional',
      municipality: 'object|optional',
      transferRecipient: 'object|optional',
    },
  })
  async newRecord(ctx: Context) {
    return ctx.call('records.create', ctx.params);
  }

  @Method
  async beforeCreate(ctx: Context<any, UserAuthMeta>) {
    let entityTenant;
    let entityUser;
    if (ctx.params.animal) {
      const animal: any = await ctx.call('animals.findOne', {
        query: {
          id: ctx.params.animal,
        },
      });

      if (!animal) {
        throw new moleculer.Errors.MoleculerClientError('Animal not found', 422, 'INVALID_ANIMAL');
      }
      entityTenant = animal.tenant;
      entityUser = animal.user;
      const method = recordPropertyNames[ctx.params.type];
      if (animal[method]) {
        throw new moleculer.Errors.MoleculerClientError(
          'Invalid record type',
          422,
          'INVALID_RECORD_TYPE',
        );
      }
    }
    if (ctx.params.species) {
      const species: Species = await ctx.call('species.findOne', {
        query: {
          id: ctx.params.species,
        },
      });

      if (!species) {
        throw new moleculer.Errors.MoleculerClientError(
          'Species not found',
          422,
          'INVALID_SPECIES',
        );
      }
      entityTenant = species.tenant;
      entityUser = species.user;
      ctx.params.permit = species.permit;
      ctx.params.speciesClassifier = species.speciesClassifier;
      if (ctx.params.type === RecordType.DEATH || ctx.params.type === RecordType.SALE) {
        if (species.amount - ctx.params.numberOfAnimals < 0) {
          throw new moleculer.Errors.MoleculerClientError(
            'Invalid number of animals',
            422,
            'INVALID_NUMBER_OF_ANIMALS',
          );
        }
      }
    }

    if (ctx.params.fosteredAnimal) {
      const fosteredAnimal: FosteredAnimal = await ctx.call('fosteredAnimals.findOne', {
        query: {
          id: ctx.params.fosteredAnimal,
        },
      });
      if (!fosteredAnimal) {
        throw new moleculer.Errors.MoleculerClientError(
          'Fostered animal not found',
          422,
          'INVALID_FOSTERED_ANIMAL',
        );
      }
      entityTenant = fosteredAnimal.tenant;
      entityUser = fosteredAnimal.user;
      ctx.params.speciesClassifier = fosteredAnimal.speciesClassifier;
    }

    if (
      ![AuthUserRole.ADMIN, AuthUserRole.SUPER_ADMIN].some(
        (role) => role === ctx.meta.authUser.type,
      )
    ) {
      const profile = ctx.meta.profile;
      const userId = ctx.meta.user.id;
      const isTenantRecord = !!profile && !!entityTenant && entityTenant == profile;
      const isUserRecord = !!userId && !!entityUser && entityUser == userId;
      if (!isTenantRecord && !isUserRecord) {
        throw new ApiGateway.Errors.UnAuthorizedError('NO_RIGHTS', {
          error: 'Unauthorized',
        });
      }
    }

    ctx.params.tenant = ctx.meta.profile;
    ctx.params.user = ctx.meta.user.id;

    return ctx;
  }
  @Action({
    rest: <RestSchema>{
      method: 'GET',
      path: '/:id/file',
      params: {
        id: 'number|convert',
      },
    },
  })
  async getPermitFile(ctx: Context<any, UserAuthMeta & MultipartMeta>) {
    const record: Record = await ctx.call('records.get', { id: ctx.params.id });
    if (!record) {
      throw new moleculer.Errors.MoleculerClientError('Invalid record', 422, 'INVALID_RECORD');
    }
    ctx.params.filename = record.file?.name;
    return this.getPresignedUrl(ctx);
  }

  @Method
  async afterCreate(ctx: Context<any, UserAuthMeta>, data: Record) {
    if (data.species) {
      const species: Species<'speciesClassifier' | 'permit'> = await ctx.call('species.get', {
        id: data?.species,
        populate: ['speciesClassifier', 'permit'],
      });
      if (
        species?.speciesClassifier?.type &&
        [
          RecordType.ACQUIREMENT,
          RecordType.DEATH,
          RecordType.BIRTH,
          RecordType.SALE,
          RecordType.OBTAINMENT_OF_FOSTERED_ANIMAL,
          RecordType.PICK_UP_FROM_NATURE,
        ].some((record) => record === data.type)
      ) {
        await ctx.call('mail.sendRecordEmail', { record: data, species });
      }
    }
  }

  @Method
  async handleFilters(ctx: Context<any, UserAuthMeta>) {
    if (ctx.params.species) {
      ctx.params.species = Number(ctx.params.species);
    }
    if (ctx.params.animal) {
      ctx.params.animal = Number(ctx.params.animal);
    }
  }
}
