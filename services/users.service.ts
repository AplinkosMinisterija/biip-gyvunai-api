'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Event, Method, Service } from 'moleculer-decorators';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  EntityChangedParams,
  FieldHookCallback,
  RestrictionType,
} from '../types';
import { TenantUser, TenantUserRole } from './tenantUsers.service';

import ApiGateway from 'moleculer-web';
import DbConnection from '../mixins/database.mixin';
import { AuthUserRole, UserAuthMeta } from './api.service';

export enum UserRole {
  ADMIN = 'ROLE_ADMIN',
  USER = 'ROLE_USER',
  INSPECTOR = 'ROLE_INSPECTOR',
}

export enum UserType {
  ADMIN = 'ADMIN',
  USER = 'USER',
}

export interface User {
  id: number;
  authUser: number;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  address: string;
  type: UserType;
  tenantUsers: Array<TenantUser['id']>;
  tenants: Record<string | number, TenantUserRole>;
}

@Service({
  name: 'users',
  mixins: [
    DbConnection({
      collection: 'users',
      entityChangedOldEntity: true,
      createActions: {
        createMany: false,
      },
    }),
  ],

  settings: {
    auth: RestrictionType.ADMIN,
    fields: {
      id: {
        type: 'string',
        columnType: 'integer',
        primaryKey: true,
        secure: true,
      },
      firstName: 'string',
      lastName: 'string',
      fullName: {
        type: 'string',
        readonly: true,
      },
      email: {
        type: 'email',
        set: ({ value }: FieldHookCallback) => value?.toLowerCase(),
      },
      phone: 'string',
      address: 'string',
      type: {
        type: 'string',
        enum: Object.values(UserType),
        default: UserType.USER,
      },
      authUser: {
        type: 'number',
        columnType: 'integer',
        columnName: 'authUserId',
        required: true,
        populate: async (ctx: Context, values: number[]) => {
          return Promise.all(
            values.map((value) => {
              try {
                const data = ctx.call('auth.users.get', {
                  id: value,
                  scope: false,
                });
                return data;
              } catch (e) {
                return value;
              }
            }),
          );
        },
      },
      lastLogin: 'date',
      tenants: {
        type: 'object',
        readonly: true,
        default: () => ({}),
      },
      tenantUsers: {
        type: 'array',
        readonly: true,
        virtual: true,
        default: (): any[] => [],
        async populate(ctx: Context, _values: any, users: User[]) {
          return await Promise.all(
            users.map(async (user) =>
              ctx.call('tenantUsers.find', {
                query: {
                  user: user.id,
                  // tenant: { $in: Object.keys(user.tenants)
                },
                populate: ['tenant'],
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

  hooks: {
    before: {
      count: 'filterTenant',
      list: 'filterTenant',
      find: 'filterTenant',
      get: 'filterTenant',
      all: 'filterTenant',
    },
  },

  actions: {
    find: {
      auth: RestrictionType.DEFAULT,
    },
    list: { auth: RestrictionType.DEFAULT },
    count: { auth: RestrictionType.DEFAULT },
    get: { auth: RestrictionType.DEFAULT },
    create: {
      rest: null,
    },
    update: {},
    remove: {},
    all: {
      auth: RestrictionType.DEFAULT,
    },
  },
})
export default class UsersService extends moleculer.Service {
  @Method
  async filterTenant(ctx: Context<any, UserAuthMeta>) {
    if (ctx.meta.user && !ctx.meta.profile) {
      throw new ApiGateway.Errors.UnAuthorizedError('NO_RIGHTS', {
        error: 'Unauthorized',
      });
    }
    if (ctx.meta.user && ctx.meta.profile) {
      ctx.params.query = {
        $raw: {
          condition: `?? \\? ?`,
          bindings: ['tenants', Number(ctx.meta.profile)],
        },
        ...ctx.params.query,
      };
    } else if (
      !ctx.meta.user &&
      ctx.meta.authUser &&
      (ctx.meta.authUser.type === AuthUserRole.ADMIN ||
        ctx.meta.authUser.type === AuthUserRole.SUPER_ADMIN)
    ) {
      if (ctx.params.filter) {
        if (typeof ctx.params.filter === 'string') {
          ctx.params.filter = JSON.parse(ctx.params.filter);
        }
        if (ctx.params.filter.tenantId) {
          let $raw;

          if (ctx.params.filter.role) {
            $raw = {
              condition: `?? @> ?::jsonb`,
              bindings: ['tenants', { [ctx.params.filter.tenantId]: ctx.params.filter.role }],
            };
          } else {
            $raw = {
              condition: `?? \\? ?`,
              bindings: ['tenants', ctx.params.filter.tenantId],
            };
          }
          ctx.params.query = {
            $raw,
            ...ctx.params.query,
          };
          delete ctx.params.filter.tenantId;
          delete ctx.params.filter.role;
        }
      }
    }
  }

  @Action({
    rest: 'PATCH /me',
    auth: RestrictionType.USER,
    params: {
      email: 'string|optional',
      phone: 'string|optional',
      address: 'string|optional',
    },
  })
  async updateMyProfile(
    ctx: Context<{ email?: string; phone?: string; address?: string }, UserAuthMeta>,
  ) {
    if (!ctx.meta.user) {
      throw new ApiGateway.Errors.UnAuthorizedError('NO_RIGHTS', {
        error: 'Not logged in',
      });
    }
    const me = await this.updateEntity(ctx, { id: ctx.meta.user.id, ...ctx.params });
    const tenantUsers: TenantUser[] = await ctx.call('tenantUsers.find', {
      query: {
        userId: me?.id,
      },
    });
    const promises = tenantUsers.map(async (tu) =>
      ctx.call('tenantUsers.update', {
        id: tu.id,
        fullName: me.fullName,
        email: me.email,
        phone: me.phone,
        address: me.address,
      }),
    );
    await Promise.all(promises);
    return me;
  }
  @Action({
    params: {
      tenantId: 'string|optional',
    },
  })
  async all(ctx: Context) {
    return this.findEntities(ctx);
  }

  @Action({
    rest: 'GET /byTenant/:tenant',
    auth: RestrictionType.DEFAULT,
    params: {
      tenant: {
        type: 'number',
        convert: true,
      },
      role: {
        type: 'string',
        optional: true,
        convert: true,
      },
    },
  })
  async byTenant(
    ctx: Context<
      { query?: object } & {
        tenant: number;
        role?: TenantUserRole;
      }
    >,
  ) {
    const { tenant, role, ...listParams } = ctx.params;
    const params = this.sanitizeParams(listParams, {
      list: true,
    });
    let $raw;

    if (role) {
      $raw = {
        condition: `?? @> ?::jsonb`,
        bindings: ['tenants', { [tenant]: role }],
      };
    } else {
      $raw = {
        condition: `?? \\? ?`,
        bindings: ['tenants', tenant],
      };
    }

    params.query = {
      $raw,
      ...params.query,
    };

    const rows = await this.findEntities(ctx, params);
    const total = await this.countEntities(ctx, params);

    return this.returnList(rows, total, params.page, params.pageSize);
  }

  @Action({
    auth: RestrictionType.DEFAULT,
    params: {
      tenants: {
        type: 'array',
        optional: true,
        items: {
          type: 'number',
          convert: true,
        },
      },
    },
  })
  async list(ctx: Context<{ query?: object } & { tenants?: number[] }>) {
    const { tenants, ...listParams } = ctx.params;
    const params = this.sanitizeParams(listParams, {
      list: true,
    });

    if (tenants) {
      const ids = tenants.map((id) => Number(id));

      const $raw = {
        condition: `?? \\?| array[${ids.map((_) => '?')}]`,
        bindings: ['tenants', ...ids],
      };

      params.query = {
        $raw,
        ...params.query,
      };
    }

    const rows = await this.findEntities(ctx, params);
    const total = await this.countEntities(ctx, params);

    return this.returnList(rows, total, params.page, params.pageSize);
  }

  @Action({
    rest: 'POST /invite',
    params: {
      personalCode: 'string',
      firstName: 'string',
      lastName: 'string',
      email: 'string',
      phone: 'string',
    },
  })
  async invite(
    ctx: Context<{
      personalCode: string;
      email: string;
      phone: string;
      firstName: string;
      lastName: string;
    }>,
  ) {
    const { personalCode, email, phone, firstName, lastName } = ctx.params;

    // it will throw error if user already exists
    const authUser: any = await ctx.call('auth.users.invite', {
      personalCode,
      notify: [email],
      throwErrors: true,
    });

    return this.createEntity(ctx, {
      authUser: authUser.id,
      firstName,
      lastName,
      email,
      phone,
    });
  }

  // CQRS - readonly cache for tenantUsers
  @Event()
  async 'tenantUsers.*'(ctx: Context<EntityChangedParams<TenantUser>>) {
    const type = ctx.params.type;
    const tenantUser = ctx.params.data as TenantUser;

    if (!tenantUser?.user) {
      return;
    }

    const $set: { tenants?: any } = {};

    const adapter = await this.getAdapter(ctx);
    const table = adapter.getTable();

    switch (type) {
      case 'create':
      case 'update':
      case 'replace':
        $set.tenants = table.client.raw(
          `tenants || '{"${tenantUser.tenant}":"${tenantUser.role}"}'::jsonb`,
        );
        break;

      case 'remove':
        $set.tenants = table.client.raw(`tenants - '${tenantUser.tenant}'`);
        break;
    }

    const user = await this.resolveEntities(ctx, { id: tenantUser.user });

    if (user) {
      await this.updateEntity(
        ctx,
        {
          id: tenantUser.user,
          $set,
        },
        {
          raw: true,
          permissive: true,
        },
      );
    }
  }

  @Method
  returnList(rows: User[], total: number, page: number, pageSize: number) {
    return {
      rows,
      total,
      page: page,
      pageSize: pageSize,
      totalPages: Math.floor((total + pageSize - 1) / pageSize),
    };
  }

  @Action({
    params: {
      authUser: 'any',
      update: {
        type: 'boolean',
        default: false,
      },
      firstName: {
        type: 'string',
        optional: true,
      },
      lastName: {
        type: 'string',
        optional: true,
      },
      email: {
        type: 'string',
        optional: true,
      },
      phone: {
        type: 'string',
        optional: true,
      },
    },
  })
  async findOrCreate(
    ctx: Context<{
      authUser: any;
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      update?: boolean;
    }>,
  ) {
    const { authUser, update, firstName, lastName, email, phone } = ctx.params;
    if (!authUser || !authUser.id) return;

    const authUserIsAdmin = ['SUPER_ADMIN', UserType.ADMIN].includes(authUser.type);

    const user: User = await this.findEntity(ctx, {
      query: {
        authUser: authUser.id,
      },
    });

    if (!update && user && user.id) return user;

    const dataToSave = {
      firstName: firstName || authUser.firstName,
      lastName: lastName || authUser.lastName,
      type: authUserIsAdmin ? UserType.ADMIN : UserType.USER,
      email: email || authUser.email,
      phone: phone || authUser.phone,
    };

    // let user to customize his phone and email
    if (user?.email) {
      delete dataToSave.email;
    }
    if (user?.phone) {
      delete dataToSave.phone;
    }

    if (user?.id) {
      return this.updateEntity(ctx, {
        id: user.id,
        ...dataToSave,
      });
    }

    return this.createEntity(ctx, {
      authUser: authUser.id,
      ...dataToSave,
    });
  }

  @Action({
    params: {
      authUser: 'any',
    },
    cache: {
      keys: ['authUser.id'],
    },
  })
  async resolveByAuthUser(ctx: Context<{ authUser: any }>) {
    const user: User = await ctx.call('users.findOrCreate', {
      authUser: ctx.params.authUser,
    });

    return user;
  }

  @Action({
    params: {
      authUser: 'any',
      authUserGroups: 'array',
    },
  })
  async createUserWithTenantsIfNeeded(ctx: Context<{ authUser: any; authUserGroups: any[] }>) {
    const { authUser, authUserGroups } = ctx.params;
    const user: User = await this.actions.findOrCreate({
      authUser: authUser,
      update: true,
    });

    if (authUserGroups && authUserGroups.length && user?.id) {
      for (const group of authUserGroups) {
        await ctx.call('tenantUsers.createRelationshipsIfNeeded', {
          authGroup: group,
          userId: user.id,
        });
      }
    }

    return user;
  }

  @Method
  async seedDB() {
    await this.broker.waitForServices(['tenants', 'tenantUsers']);
    const usersCount: number = await this.countEntities(null, {});

    if (!usersCount) {
      const data: any[] = await this.broker.call('auth.getSeedData');

      for (const item of data) {
        await this.actions.createUserWithTenantsIfNeeded({
          authUser: item,
          authUserGroups: item.groups,
        });
      }
    }
  }
}
