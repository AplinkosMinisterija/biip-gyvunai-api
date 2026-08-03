import { Context } from 'moleculer';
import { AuthUserRole, UserAuthMeta } from '../services/api.service';

export default {
  methods: {
    // Leidžia rūšiuoti tik pagal realias (ne virtualias) lenteles kolonas —
    // kitaip knex sugeneruoja `"user"."firstName"` tipo SQL ir užklausa lūžta.
    sanitizeSort(sort?: string | string[]): string[] | undefined {
      if (!sort) return undefined;

      const items = Array.isArray(sort)
        ? sort
        : String(sort).replace(/,/g, ' ').split(' ').filter(Boolean);

      const sortable = items.filter((item) => {
        const fieldName = String(item).replace(/^-/, '');
        return this.$fields?.some((field: any) => field.name === fieldName && !field.virtual);
      });

      return sortable.length ? sortable : undefined;
    },

    applyAccessFilter(ctx: Context<any, UserAuthMeta>, useRawUsers = false) {
      const { meta } = ctx;
      if (!meta) return ctx;

      ctx.params.sort = this.sanitizeSort(ctx.params.sort) || '-createdAt';

      const { authUser, profile, user } = meta;

      const isAdmin = [AuthUserRole.SUPER_ADMIN, AuthUserRole.ADMIN].includes(authUser?.type);
      if (isAdmin) {
        return ctx;
      }

      const q = ctx.params.query || {};

      if (profile && user) {
        ctx.params.query = {
          tenant: profile,
          ...q,
        };
      } else if (!profile && user) {
        const userId = Number(user.id);

        if (!userId) {
          ctx.params.query = {
            $raw: { condition: 'FALSE', bindings: [] },
          };
          return ctx;
        }

        if (useRawUsers) {
          ctx.params.query = {
            users: {
              $raw: {
                condition: `"users" @> to_jsonb(?::int[])`,
                bindings: [[userId]],
              },
            },
            ...q,
          };
        } else {
          ctx.params.query = {
            user: userId,
            ...q,
          };
        }
      }

      return ctx;
    },

    beforeSelect(ctx: Context<any, UserAuthMeta>) {
      return this.applyAccessFilter(ctx, false);
    },

    beforeSelectPermit(ctx: Context<any, UserAuthMeta>) {
      return this.applyAccessFilter(ctx, true);
    },
  },
};
