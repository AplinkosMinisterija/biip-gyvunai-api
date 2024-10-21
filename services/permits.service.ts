'use strict';

import moleculer, { Context, RestSchema } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';

import PostgisMixin from 'moleculer-postgis';
import ApiGateway from 'moleculer-web';
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
  RestrictionType,
  Table,
  throwBadRequestError,
  throwValidationError,
} from '../types';
import { formatDateFrom, formatDateTo, handleFormatResponse, isAdmin } from '../types/functions';
import { UserAuthMeta } from './api.service';
import { IssuerClassifier } from './issuerClassifiers.service';
import { PermitSpecies } from './permits.species.service';
import { Species } from './species.service';
import { Tenant } from './tenants.service';
import { User } from './users.service';

enum PermitTypes {
  ZOO = 'ZOO',
  AVIARY = 'AVIARY',
}

interface Fields extends CommonFields {
  id: number;
  permitNumber: string;
  issueDate: string;
  issuer: IssuerClassifier['id'];
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
  specialConditions: string;
  tenant: number;
  user: number;
  permitSpecies: {
    id: number;
    name: string;
    nameLatin: string;
    type: 'species' | 'other';
  }[];
  species: Species[];
  file: {
    url: string;
    name: string;
    size: number;
  };
  aviarySizeIndoor?: number;
  aviarySizeOutdoor?: number;
  aviaryHeight?: number;
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
    UploadMixin,
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
      forest: 'boolean',
      fencingOffDate: 'string',
      fencedArea: 'number',
      protectedTerritory: 'boolean',
      note: 'string',
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
      permitSpecies: {
        virtual: true,
        type: 'array',
        populate: {
          keyField: 'id',
          action: 'permitSpecies.populateByProp',
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
      aviarySizeIndoor: 'number',
      aviarySizeOutdoor: 'number',
      aviaryHeight: 'number',
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
    rest: ['POST /', 'PATCH /:id'],
  })
  async createOrUpdate(
    ctx: Context<{ permitSpecies: PermitSpecies[]; id?: number }, UserAuthMeta>,
  ) {
    const { permitSpecies, id } = ctx.params;

    const permit: PermitSpecies = await ctx.call(
      id ? 'permits.update' : 'permits.create',
      ctx.params,
    );

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

    const isCreatedBy =
      (ctx?.meta?.profile && ctx?.meta?.profile === permit.tenant) ||
      (!ctx.meta?.profile && ctx?.meta?.user?.id === permit.user);

    if (isAdmin(ctx)) {
      return throwBadRequestError('Permit already exists');
    }

    if (!permit.user && !permit.tenant) return { permit };

    if (isCreatedBy) {
      return throwBadRequestError('Permit already exists');
    }

    throwValidationError('Invalid permit');
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
    if (!isAdmin(ctx)) {
      const profile = ctx.meta.profile;
      const userId = ctx.meta.user.id;
      ctx.params.tenant = profile || null;
      ctx.params.user = !profile ? userId : null;
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
  async saveOrUpdateSpeciesForPermit(id: number, permitSpeciesList: PermitSpecies[]) {
    const savedIds: number[] = [];

    for (const species of permitSpeciesList) {
      const createdSpecies: PermitSpecies = await this.broker.call(
        'permits.species.createOrUpdate',
        {
          ...species,
          permit: id,
        },
      );

      savedIds.push(createdSpecies.id);
    }

    const allSpecies: PermitSpecies[] = await this.broker.call('permits.species.find', {
      query: {
        permit: id,
      },
    });

    const deletingIds: number[] = allSpecies
      .map((species) => species.id)
      .filter((speciesId) => !savedIds.includes(speciesId));

    deletingIds.map((speciesId) => this.broker.call('permits.species.remove', { id: speciesId }));
  }

  @Method
  async beforeUpdate(ctx: Context<any, UserAuthMeta>) {
    const existingPermit = await this.findEntity(ctx, {
      query: JSON.stringify({
        id: Number(ctx.params.id),
        tenant: ctx.params.profile || null,
        user: !!ctx.params.profile ? ctx.params.user : null,
      }),
    });
    if (!existingPermit) {
      return throwValidationError('Invalid permit');
    }
    if (!isAdmin(ctx)) {
      const profile = ctx.meta.profile;
      const userId = ctx.meta.user.id;

      const sameUser = !profile && existingPermit.user === userId;
      const sameTenant = profile && existingPermit.tenant === profile;
      const permitAssigned = existingPermit.user || existingPermit.tenant;
      if (permitAssigned && !(sameUser || sameTenant)) {
        throw new ApiGateway.Errors.UnAuthorizedError('NO_RIGHTS', {
          error: 'Unauthorized',
        });
      }
      ctx.params.tenant = profile || null;
      ctx.params.user = !profile ? userId : null;
    }
    return ctx;
  }
}
