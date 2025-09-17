'use strict';

import moleculer, { Context, RestSchema } from 'moleculer';
import { Action, Event, Method, Service } from 'moleculer-decorators';

import PostgisMixin from 'moleculer-postgis';
import DbConnection from '../mixins/database.mixin';
import ProfileMixin from '../mixins/profile.mixin';
import {
  COMMON_ACTION_PARAMS,
  COMMON_DEFAULT_SCOPES,
  COMMON_DELETED_SCOPES,
  COMMON_FIELDS,
  COMMON_PAGINATION_PARAMS,
  COMMON_SCOPES,
  CommonActionParams,
  CommonFields,
  CommonPopulates,
  EntityChangedParams,
  RestrictionType,
  Table,
  throwBadRequestError,
  throwNoRightsError,
  throwValidationError,
} from '../types';
import { formatDateFrom, formatDateTo, handleFormatResponse, isAdmin } from '../types/functions';
import { UserAuthMeta } from './api.service';
import { FamilyClassifier } from './familyClassifiers.service';
import { IssuerClassifier } from './issuerClassifiers.service';
import { PermitHistoryTypes } from './permits.histories.service';
import { PermitSpecies } from './permits.species.service';
import { Species } from './species.service';
import { SpeciesClassifier } from './speciesClassifiers.service';
import { Tenant } from './tenants.service';
import { User } from './users.service';

enum PermitTypes {
  ZOO = 'ZOO',
  AVIARY = 'AVIARY',
}

enum DeleteReasons {
  NON_COMPLIANCE = 'NON_COMPLIANCE',
  REQUESTED_CANCELLATION = 'REQUESTED_CANCELLATION',
  ENTITY_DISSOLVED = 'ENTITY_DISSOLVED',
  HOLDER_DECEASED = 'HOLDER_DECEASED',
  DISEASE_OUTBREAK = 'DISEASE_OUTBREAK',
  NO_ANIMALS_FOR_YEAR = 'NO_ANIMALS_FOR_YEAR',
  INSUFFICIENT_SPACE = 'INSUFFICIENT_SPACE',
  NO_ANIMALS_INTRODUCED = 'NO_ANIMALS_INTRODUCED',
  FRAUDULENT_INFO = 'FRAUDULENT_INFO',
  EXPIRED = 'EXPIRED',
  OTHER = 'OTHER',
}

interface Fields extends CommonFields {
  id: number;
  permitNumber: string;
  issueDate: string;
  issuer: IssuerClassifier['id'];
  deleteReason: DeleteReasons;
  deleteOtherReason: string;
  type: PermitTypes;
  address: string;
  municipality: {
    id: number;
    name: string;
  };
  forest: boolean;
  fencingOffDate: string;
  fencedArea: number;
  protectedTerritory: boolean;
  note: string;
  info: string;
  cadastralIds: string[];
  buildingIds: string[];
  specialConditions: string;
  tenant: number;
  users: number[];
  permitSpecies: {
    id: number;
    family: FamilyClassifier;
    species: Species;
  }[];
  species: Species[];
  file: {
    url: string;
    name: string;
    size: number;
  };
  aviarySizeIndoor?: string;
  aviarySizeOutdoor?: string;
  aviaryHeight?: string;
}

interface Populates extends CommonPopulates {
  species: Species[];
  issuer: IssuerClassifier;
  user: User;
  tenant: Tenant;
}

export type Permit<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

const PERMIT_ACTION_PARAMS = {
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
    default: ['municipality.name'],
  },
  ...COMMON_ACTION_PARAMS,
};

const PERMIT_ACTION_PAGINATION_PARAMS = {
  ...PERMIT_ACTION_PARAMS,
  ...COMMON_PAGINATION_PARAMS,
};

@Service({
  name: 'permits',
  mixins: [
    DbConnection(),
    PostgisMixin({
      srid: 3346,
    }),
    ProfileMixin,
  ],
  settings: {
    fields: {
      id: {
        type: 'string',
        columnType: 'integer',
        primaryKey: true,
        secure: true,
      },
      permitNumber: 'string|required',
      issueDate: {
        type: 'date',
        columnType: 'datetime',
        required: true,
      },
      issuer: {
        type: 'number',
        columnType: 'integer',
        columnName: 'issuerId',
        required: true,
        populate: {
          action: 'issuerClassifiers.resolve',
          params: {
            scope: false,
          },
        },
      },
      type: 'string',
      address: 'string',
      municipality: 'object',
      cadastralIds: {
        type: 'array',
        items: 'string',
      },
      buildingIds: {
        type: 'array',
        items: 'string',
      },
      forest: 'boolean',
      fencingOffDate: 'string',
      fencedArea: 'number',
      protectedTerritory: 'boolean',
      note: 'string',
      info: 'string',
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
      users: {
        columnType: 'jsonb',
        get: ({ entity }: { entity: Permit }) => entity.users || [],
        items: { type: 'number' },
        populate: {
          action: 'users.resolve',
          params: {
            scope: false,
          },
        },
      },
      permitSpecies: {
        virtual: true,
        type: 'array',
        populate: {
          keyField: 'id',
          action: 'permits.species.populateByProp',
          params: {
            populate: 'species,family',
            mappingMulti: true,
            queryKey: 'permit',
          },
        },
      },
      specialConditions: 'string',
      file: 'array',
      geom: {
        type: 'any',
        geom: {
          types: ['Point'],
        },
      },
      aviarySizeIndoor: 'string',
      aviarySizeOutdoor: 'string',
      aviaryHeight: 'string',
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
    defaultPopulates: ['issuer', 'geom'],
  },
  actions: {
    create: {
      rest: null,
    },
    remove: {
      rest: null,
    },
    update: {
      rest: null,
    },
  },
  hooks: {
    before: {
      create: 'beforeCreate',
      list: 'beforeSelect',
      find: 'beforeSelect',
      count: 'beforeSelect',
      get: 'beforeSelect',
      all: 'beforeSelect',
      update: 'beforeUpdate',
    },
  },
})
export default class PermitsService extends moleculer.Service {
  @Action({
    rest: 'GET /:id/history',
    params: {
      id: {
        type: 'number',
        convert: true,
      },
    },
  })
  async getHistory(
    ctx: Context<{
      id: number;
      type?: string;
      page?: number;
      pageSize?: number;
    }>,
  ) {
    return ctx.call(`permits.histories.${ctx.params.type || 'list'}`, {
      sort: '-createdAt',
      query: {
        permit: ctx.params.id,
      },
      page: ctx.params.page,
      pageSize: ctx.params.pageSize,
      populate: 'createdBy',
    });
  }

  @Action({
    rest: 'DELETE /:id',
    params: {
      id: {
        type: 'number',
        convert: true,
      },
      deleteReason: {
        type: 'string',
        enum: Object.values(DeleteReasons),
      },
      deleteOtherReason: {
        type: 'string',
        optional: true,
      },
    },
    types: [RestrictionType.ADMIN],
  })
  async removePermit(
    ctx: Context<
      { id: number; deleteReason: DeleteReasons; deleteOtherReason?: string },
      UserAuthMeta
    >,
  ) {
    const { id, deleteReason, deleteOtherReason } = ctx.params;
    const accesses = ctx?.meta?.authUser?.permissions?.NLG?.accesses ?? [];
    const canRemovePermit = accesses.includes('*') || accesses.includes('DELETE_PERMITS');

    if (!canRemovePermit) {
      throwNoRightsError();
    }

    await ctx.call('permits.remove', {
      id,
    });

    await this.createPermitHistory(
      id,
      ctx.meta,
      PermitHistoryTypes.DELETED,
      deleteReason,
      deleteOtherReason,
    );

    return id;
  }

  @Action({
    rest: 'GET /deleted',
  })
  listDeleted(ctx: Context<{}>) {
    return ctx.call('permits.list', {
      ...ctx.params,
      scope: COMMON_DELETED_SCOPES,
    });
  }

  @Action({
    rest: ['POST /', 'PATCH /:id'],
    types: [RestrictionType.ADMIN],
  })
  async createOrUpdate(
    ctx: Context<{ permitSpecies: PermitSpecies[]; id?: number }, UserAuthMeta>,
  ) {
    const id = ctx?.params?.id;
    const permitSpecies = ctx?.params?.permitSpecies || [];

    const uniqueFamilySpecies: any = {};
    const uniqueFamily: any = {};

    for (const species of permitSpecies) {
      const { family, species: speciesId } = species;
      const familyKey = family;
      const familySpeciesKey = `${family}-${speciesId}`;

      if (!speciesId ? uniqueFamily[familyKey] : uniqueFamilySpecies[familySpeciesKey]) {
        throwValidationError('Duplicate entry found');
      }

      uniqueFamily[familyKey] = 1;

      if (speciesId) {
        uniqueFamilySpecies[familySpeciesKey] = 1;

        const speciesData: SpeciesClassifier = await ctx.call('speciesClassifiers.resolve', {
          id: speciesId,
        });

        if (speciesData?.family !== family) {
          throwValidationError('The species does not belong to the specified family.');
        }
      }
    }

    const permit: PermitSpecies = await ctx.call(id ? 'permits.update' : 'permits.create', {
      ...ctx.params,
    });

    await this.saveOrUpdateSpeciesForPermit(permit.id, permitSpecies);

    return ctx.call('permits.resolve', { id: permit.id });
  }

  @Action({
    rest: <RestSchema>{
      method: 'GET',
      basePath: '/public/permits',
      path: '/',
    },
    auth: RestrictionType.PUBLIC,
    params: PERMIT_ACTION_PAGINATION_PARAMS,
  })
  async publicPermitsByMunicipality(ctx: Context<CommonActionParams>) {
    return await this.getPublicPermitsByMunicipality(ctx);
  }

  @Action({
    rest: <RestSchema>{
      method: 'GET',
      basePath: '/public/permits',
      path: '/all',
    },
    auth: RestrictionType.PUBLIC,
    params: PERMIT_ACTION_PARAMS,
  })
  async publicPermitsByMunicipalityAll(ctx: Context<CommonActionParams>) {
    return await this.getPublicPermitsByMunicipality(ctx, true);
  }

  @Action({
    rest: <RestSchema>{
      method: 'GET',
      basePath: '/public/aviaries',
      path: '/',
    },
    auth: RestrictionType.PUBLIC,
    params: PERMIT_ACTION_PAGINATION_PARAMS,
  })
  async publicAviariesByMunicipality(ctx: Context<CommonActionParams>) {
    return await this.getPublicAviariesByMunicipality(ctx);
  }

  @Action({
    rest: <RestSchema>{
      method: 'GET',
      basePath: '/public/aviaries',
      path: '/all',
    },
    auth: RestrictionType.PUBLIC,
    params: PERMIT_ACTION_PARAMS,
  })
  async publicAviariesByMunicipalityAll(ctx: Context<CommonActionParams>) {
    return await this.getPublicAviariesByMunicipality(ctx, true);
  }

  @Action({
    rest: <RestSchema>{
      method: 'GET',
      basePath: '/public/statistics/general',
      path: '/',
    },
    auth: RestrictionType.PUBLIC,
  })
  async generalStatistic(ctx: Context) {
    const general = { aviariesCount: 0, zoosCount: 0, speciesCount: 0, speciesClassifiersCount: 0 };
    const uniqueSpeciesClassifiers: { [key: string]: number } = {};
    const permits: Permit[] = await ctx.call('permits.find');

    const species: Species[] = await ctx.call('species.find', {
      query: {
        permit: { $exists: true },
        speciesClassifier: { $exists: true },
        amount: { $exists: true },
      },
    });

    permits.forEach((permit) => {
      if (permit.type === PermitTypes.AVIARY) {
        general.aviariesCount++;
      } else if (permit.type === PermitTypes.ZOO) {
        general.zoosCount++;
      }
    });

    species.forEach((species) => {
      uniqueSpeciesClassifiers[species.speciesClassifier] = 1;
      general.speciesCount += species.amount;
    });

    general.speciesClassifiersCount = Object.keys(uniqueSpeciesClassifiers).length;

    return general;
  }

  @Action({
    rest: 'GET /validate',
  })
  async validatePermit(
    ctx: Context<
      { query: { permitNumber: string; issuer: number; issueDate: string; id?: number } },
      UserAuthMeta
    >,
  ): Promise<any> {
    if (typeof ctx.params.query === 'string') {
      try {
        ctx.params.query = JSON.parse(ctx.params.query);
      } catch (err) {}
    }

    const { issuer, issueDate, permitNumber, id } = ctx?.params?.query;

    if (!issuer || !issueDate || !permitNumber) {
      return { permit: null };
    }

    const permit: Permit = await ctx.call('permits.findOne', {
      query: {
        issuer,
        permitNumber,
        issueDate,
        ...(!!id && { id: { $ne: id } }),
      },
    });

    if (!permit) {
      return { permit: null };
    }

    if (isAdmin(ctx)) {
      return throwBadRequestError('Permit already exists');
    }

    throwValidationError('Invalid permit');
  }

  @Action({
    rest: <RestSchema>{
      method: 'POST',
      path: '/upload',
      type: 'multipart',
      busboyConfig: {
        limits: {
          files: 1,
        },
      },
    },
  })
  async upload(ctx: Context<{}>) {
    return ctx.call('minio.uploadFile', {
      payload: ctx.params,
      folder: 'permits',
    });
  }

  @Method
  async beforeCreate(ctx: Context<any, UserAuthMeta>) {
    const existingPermit = await this.findEntity(ctx, {
      query: JSON.stringify({
        issueDate: {
          $gte: formatDateFrom(ctx.params.issueDate),
          $lte: formatDateTo(ctx.params.issueDate),
        },
        issuer: ctx.params.issuer,
        permitNumber: ctx.params.permitNumber,
      }),
    });
    if (existingPermit) {
      return throwBadRequestError('Permit already exists');
    }

    return ctx;
  }

  @Method
  async getPublicPermitsByMunicipality(ctx: Context<CommonActionParams>, all: boolean = false) {
    const permits: Permit[] = await ctx.call('permits.find');

    const sort = ctx?.params?.sort;
    const page = ctx?.params?.page;
    const pageSize = ctx?.params?.pageSize;
    const search = ctx?.params?.search;
    const searchFields = ctx?.params?.searchFields;

    const aggregatePermitInfo = (
      permits: { [key: string]: any },
      currentPermit: Permit,
      groupKey: number,
    ) => {
      permits[groupKey].count++;
      if (currentPermit.type === PermitTypes.AVIARY) {
        permits[groupKey].aviariesCount++;

        if (currentPermit.forest) {
          permits[groupKey].forestsCount++;
        }

        if (currentPermit.protectedTerritory) {
          permits[groupKey].protectedTerritoriesCount++;
        }
      } else if (currentPermit.type === PermitTypes.ZOO) {
        permits[groupKey].zoosCount++;
      }
    };

    const formattedPermits = Object.values(
      permits.reduce((permits, currentPermit) => {
        const municipality = currentPermit?.municipality;
        const groupKey = municipality?.id;
        if (!permits[groupKey]) {
          permits[groupKey] = {
            municipality,
            count: 0,
            aviariesCount: 0,
            zoosCount: 0,
            forestsCount: 0,
            protectedTerritoriesCount: 0,
          };
        }

        aggregatePermitInfo(permits, currentPermit, groupKey);

        return permits;
      }, {} as { [key: string]: any }),
    );

    return handleFormatResponse({
      data: formattedPermits,
      search,
      searchFields,
      all,
      sort,
      page,
      pageSize,
    });
  }

  @Method
  async getPublicAviariesByMunicipality(ctx: Context<CommonActionParams>, all: boolean = false) {
    const permits: Permit[] = await ctx.call('permits.find', {
      query: {
        type: PermitTypes.AVIARY,
        fencingOffDate: { $exists: true },
        fencedArea: { $exists: true },
        forest: true,
      },
    });
    const sort = ctx?.params?.sort;
    const search = ctx?.params?.search;
    const searchFields = ctx?.params?.searchFields;
    const page = ctx?.params?.page;
    const pageSize = ctx?.params?.pageSize;

    const aggregateAviaryInfo = (
      permits: { [key: string]: any },
      currentPermit: Permit,
      groupKey: number,
    ) => {
      permits[groupKey].count++;
      permits[groupKey].fencedAreaSum += parseFloat(currentPermit.fencedArea as any);
    };

    const formattedAviaries = Object.values(
      permits.reduce((permits, currentPermit) => {
        const municipality = currentPermit?.municipality;
        const groupKey = municipality?.id;
        if (!permits[groupKey]) {
          permits[groupKey] = {
            municipality,
            fencedAreaSum: 0,
            count: 0,
          };
        }
        aggregateAviaryInfo(permits, currentPermit, groupKey);

        return permits;
      }, {} as { [key: string]: any }),
    );

    return handleFormatResponse({
      data: formattedAviaries,
      all,
      search,
      searchFields,
      sort,
      page,
      pageSize,
    });
  }

  @Method
  async saveOrUpdateSpeciesForPermit(permitId: number, permitSpeciesList: PermitSpecies[]) {
    const speciesIdsToSave: number[] = [];

    for (const species of permitSpeciesList) {
      const updatedSpecies: PermitSpecies = await this.broker.call(
        'permits.species.createOrUpdate',
        { ...species, permit: permitId },
      );

      speciesIdsToSave.push(updatedSpecies.id);
    }

    const existingSpecies: PermitSpecies[] = await this.broker.call('permits.species.find', {
      query: { permit: permitId },
    });

    const speciesIdsToDelete: number[] = existingSpecies
      .map((species) => species.id)
      .filter((speciesId) => !speciesIdsToSave.includes(speciesId));

    await Promise.all(
      speciesIdsToDelete.map(
        async (speciesId) => await this.broker.call('permits.species.remove', { id: speciesId }),
      ),
    );
  }

  @Method
  async beforeUpdate(ctx: Context<any, UserAuthMeta>) {
    const existingPermit: Permit = await this.resolveEntities(ctx, {
      id: ctx.params.id,
      throwIfNotExist: true,
    });
    if (!existingPermit) {
      return throwValidationError('Invalid permit');
    }

    return ctx;
  }

  @Method
  createPermitHistory(
    permit: number | string,
    meta: any,
    type: string,
    deleteReason?: DeleteReasons,
    deleteOtherReason?: string,
  ) {
    return this.broker.call(
      'permits.histories.create',
      {
        permit,
        deleteReason,
        deleteOtherReason,
        type,
      },
      { meta },
    );
  }

  @Event()
  async 'permits.updated'(ctx: Context<EntityChangedParams<Permit>>) {
    const { data: permit } = ctx.params;

    await this.createPermitHistory((permit as Permit).id, ctx.meta, PermitHistoryTypes.UPDATED);
  }

  @Event()
  async 'permits.created'(ctx: Context<EntityChangedParams<Permit>>) {
    const { data: permit } = ctx.params;

    await this.createPermitHistory((permit as Permit).id, ctx.meta, PermitHistoryTypes.CREATED);
  }
}
