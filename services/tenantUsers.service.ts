'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Event, Method, Service } from 'moleculer-decorators';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  CommonFields,
  CommonPopulates,
  RestrictionType,
  Table,
  isAdmin,
  throwNoRightsError,
  throwNotFoundError,
} from '../types';
import { AuthUserRole, UserAuthMeta } from './api.service';
import { User } from './users.service';

import DbConnection from '../mixins/database.mixin';
import ProfileMixin from '../mixins/profile.mixin';
import { Tenant } from './tenants.service';

export enum AuthGroupRole {
  ADMIN = 'ADMIN',
  USER = 'USER',
}

export enum TenantUserRole {
  USER = 'USER',
  USER_ADMIN = 'USER_ADMIN',
  OWNER = 'OWNER',
}

interface Fields extends CommonFields {
  id: string;
  tenant: Tenant['id'];
  user: User['id'];
  role: TenantUserRole;
}

interface Populates extends CommonPopulates {
  user: User;
  tenant: Tenant;
}

// Įmonės narius tvarkyti gali jos savininkas ir naudotojų administratorius.
const MANAGER_ROLES: (TenantUserRole | undefined)[] = [
  TenantUserRole.OWNER,
  TenantUserRole.USER_ADMIN,
];

// Užklausos iš API vartų (`services/api.service.ts`) ateina su šiuo `ctx.caller`.
const API_SERVICE = 'api';

export type TenantUser<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'tenantUsers',

  mixins: [
    DbConnection({
      collection: 'tenantUsers',
      entityChangedOldEntity: true,
      createActions: {
        createMany: false,
      },
    }),
    ProfileMixin,
  ],

  settings: {
    auth: RestrictionType.ADMIN,

    plantuml: {
      relations: {
        tenants: 'zero-or-many-to-one',
        users: 'zero-or-many-to-one',
      },
    },

    fields: {
      id: {
        type: 'string',
        columnType: 'integer',
        primaryKey: true,
        secure: true,
      },
      tenant: {
        type: 'number',
        columnType: 'integer',
        columnName: 'tenantId',
        required: true,
        immutable: true,
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
        required: true,
        immutable: true,
        populate: {
          action: 'users.resolve',
          params: {
            scope: false,
          },
        },
        // validate: "validateTenant",
      },
      role: {
        type: 'string',
        enum: Object.values(TenantUserRole),
        default: TenantUserRole.USER,
      },
      fullName: 'string',
      email: 'string',
      phone: 'string',
      address: 'string',
      ...COMMON_FIELDS,
    },

    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
    defaultPopulate: ['user'],
  },

  // TODO: list action - hooksu apriboti tik useriui priklausancius
  hooks: {
    before: {
      create: ['beforeCreate'],
      update: 'assertCanManageMember',
      remove: 'assertCanManageMember',
      list: 'beforeSelect',
      find: 'beforeSelect',
      count: 'beforeSelect',
      get: 'beforeSelect',
      all: 'beforeSelect',
    },
  },

  actions: {
    find: {},
    list: {
      auth: RestrictionType.DEFAULT,
    },
    count: {},
    get: {},
    create: {
      auth: RestrictionType.ADMIN,
    },
    update: {
      auth: RestrictionType.DEFAULT,
    },
    remove: {
      auth: RestrictionType.DEFAULT,
    },
  },
})
export default class TenantUsersService extends moleculer.Service {
  // Per API narystę keisti ar šalinti gali administratorius arba tos pačios įmonės savininkas
  // ar jos naudotojų administratorius, pasirinkęs įmonės profilį; svetima narystė „neegzistuoja“
  // (404). Vidiniai kvietimai (prisijungimo sinchronizavimas, profilio atnaujinimas) neribojami:
  // `ctx.caller` klientas per API nustatyti negali.
  @Method
  async assertCanManageMember(
    ctx: Context<{ id: number | string; role?: TenantUserRole }, UserAuthMeta>,
  ) {
    if (ctx.caller !== API_SERVICE || isAdmin(ctx)) return ctx;

    const { profile, user } = ctx.meta;
    const manager: TenantUser | undefined =
      profile && user
        ? await this.findEntity(ctx, { query: { tenant: profile, user: user.id } })
        : undefined;
    const member: TenantUser | undefined = MANAGER_ROLES.includes(manager?.role)
      ? await this.findEntity(ctx, { query: { id: ctx.params.id, tenant: profile } })
      : undefined;
    if (!member) throwNotFoundError('Tenant user not found');

    // Savininko narystę keisti ir savininko rolę suteikti gali tik savininkas — kitaip naudotojų
    // administratorius galėtų pats tapti savininku arba jį pašalinti.
    const concernsOwner =
      member.role === TenantUserRole.OWNER || ctx.params.role === TenantUserRole.OWNER;
    if (concernsOwner && manager.role !== TenantUserRole.OWNER) throwNoRightsError();

    return ctx;
  }

  @Action({
    rest: 'GET /my',
    auth: RestrictionType.USER,
  })
  my(ctx: Context<null, UserAuthMeta>) {
    return this.findEntities(ctx, {
      query: {
        user: ctx.meta.user.id,
      },
    });
  }

  @Action({
    rest: 'POST /invite',
    auth: RestrictionType.DEFAULT,
    params: {
      firstName: 'string',
      lastName: 'string',
      personalCode: 'string',
      phone: {
        type: 'string',
        optional: true,
      },
      role: {
        type: 'enum',
        values: Object.values(TenantUserRole),
      },
      tenant: 'number',
      email: {
        type: 'string',
        optional: true,
      },
    },
  })
  async invite(
    ctx: Context<
      {
        tenant: number;
        role: TenantUserRole;
        firstName: string;
        lastName: string;
        personalCode: string;
        email: string;
        phone: string;
      },
      UserAuthMeta
    >,
  ) {
    const { firstName, lastName, personalCode, role, email, phone, tenant: tenantId } = ctx.params;

    if (ctx.meta.authUser.type === AuthUserRole.USER) {
      if (!ctx.meta.profile || !ctx.meta.user) {
        throw new moleculer.Errors.MoleculerClientError(
          'Tenant profile not selected',
          401,
          'INVALID_PROFILE',
        );
      }
      const profileData = await this.findEntity(ctx, {
        query: { tenantId: ctx.meta.profile, userId: ctx.meta.user.id },
      });
      // Kviesti galima tik į įmonę, kurios profilis pasirinktas.
      if (Number(tenantId) !== Number(ctx.meta.profile)) {
        throw new moleculer.Errors.MoleculerClientError(
          'Users can be added only to the selected tenant.',
          401,
          'NO_RIGHTS',
        );
      }
      if (!MANAGER_ROLES.includes(profileData?.role)) {
        throw new moleculer.Errors.MoleculerClientError(
          'Only OWNER and USER_ADMIN can add users to tenant.',
          401,
          'NO_RIGHTS',
        );
      }
      // Savininko rolę suteikia tik savininkas (žr. `assertCanManageMember`).
      if (role === TenantUserRole.OWNER && profileData.role !== TenantUserRole.OWNER) {
        throwNoRightsError();
      }
    }

    const tenant: Tenant = await ctx.call('tenants.resolve', { id: tenantId });

    const authRole =
      role === TenantUserRole.OWNER || role === TenantUserRole.USER_ADMIN
        ? AuthGroupRole.ADMIN
        : AuthGroupRole.USER;

    const inviteData: any = {
      personalCode,
      companyId: tenant.authGroup,
      role: authRole,
    };

    if (email) {
      inviteData.notify = [email];
    }

    // if user aleady in group - it will throw error
    const authUser: any = await ctx.call('auth.users.invite', inviteData);

    let user: User = await ctx.call('users.findOne', {
      query: {
        authUser: authUser.id,
      },
    });

    if (!user) {
      user = await ctx.call('users.create', {
        authUser: authUser.id,
        firstName,
        lastName,
        email,
        phone,
      });
    }

    return this.createEntity(ctx, {
      tenant: tenant.id,
      user: user.id,
      role,
    });
  }

  @Action({ visibility: 'public' })
  async getProfiles(ctx: Context<{}, UserAuthMeta>) {
    const { user } = ctx.meta;
    if ([AuthUserRole.ADMIN, AuthUserRole.SUPER_ADMIN].some((r) => r === ctx.meta.authUser.type))
      return [];
    const tenantUsers: TenantUser[] = await this.findEntities(null, {
      query: {
        user: user.id,
      },
      populate: 'tenant',
    });

    const profiles: any[] = tenantUsers?.map((tenantUser: any) => {
      return {
        id: tenantUser.tenant.id,
        name: tenantUser.tenant.name,
        email: user.email,
        phone: user.phone,
        role: tenantUser.role,
        code: tenantUser.tenant.code,
      };
    });

    profiles.push({
      id: 'personal',
      name: `${user.firstName} ${user.lastName}`,
      email: user.email,
      phone: user.phone,
    });

    return profiles;
  }

  @Method
  async beforeCreate(ctx: Context<any>) {
    const { user, tenant } = ctx.params;

    const tenantUsersCount = await ctx.call('tenantUsers.count', {
      query: {
        tenant,
        user,
      },
    });

    if (tenantUsersCount) {
      throw new moleculer.Errors.MoleculerClientError('Already exists', 422, 'ALREADY_EXISTS');
    }

    const userEntity: User = await ctx.call('users.get', { id: user });
    const tenantEntity: Tenant = await ctx.call('tenants.get', { id: tenant });

    await ctx.call('auth.users.assignToGroup', {
      id: userEntity.authUser,
      groupId: tenantEntity.authGroup,
    });
  }

  @Action({
    visibility: 'public',
    params: {
      authGroup: 'any',
      userId: {
        type: 'number',
        convert: true,
      },
      companyEmail: {
        type: 'string',
        optional: true,
      },
      companyPhone: {
        type: 'string',
        optional: true,
      },
      companyName: {
        type: 'string',
        optional: true,
      },
    },
  })
  async createRelationshipsIfNeeded(
    ctx: Context<{
      authGroup: any;
      userId: number;
      companyEmail?: string;
      companyPhone?: string;
      companyName?: string;
    }>,
  ) {
    const { authGroup, userId, companyEmail, companyPhone, companyName } = ctx.params;

    if (!authGroup?.id) return;

    const tenant: Tenant = await ctx.call('tenants.findOrCreate', {
      authGroup: authGroup,
      email: companyEmail,
      phone: companyPhone,
      name: companyName,
    });

    if (!tenant || !tenant.id) {
      throw new moleculer.Errors.MoleculerClientError(
        'Cannot create or update tenant.',
        401,
        'UNAUTHORIZED',
      );
    }

    const query = {
      tenant: tenant.id,
      user: userId,
    };

    const tenantUser: TenantUser = await ctx.call('tenantUsers.findOne', {
      query,
    });

    if (tenantUser && !!authGroup?.role && authGroup.role === tenantUser.role) return tenantUser;

    if (tenantUser?.id) {
      return ctx.call('tenantUsers.update', {
        id: tenantUser.id,
        role: authGroup.role || TenantUserRole.USER,
      });
    }

    return ctx.call('tenantUsers.create', {
      ...query,
      role: authGroup.role || TenantUserRole.USER,
    });
  }

  @Event()
  async 'users.removed'(ctx: Context<{ data: User }>) {
    const user = ctx.params.data;

    return this.removeEntities(ctx, {
      query: {
        user: user.id,
      },
    });
  }

  @Event()
  async 'tenants.removed'(ctx: Context<{ data: Tenant }>) {
    const tenant = ctx.params.data;

    return this.removeEntities(ctx, {
      query: {
        tenant: tenant.id,
      },
    });
  }
}
