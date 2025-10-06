import { Context } from 'moleculer';
import { AuthUserRole, UserAuthMeta } from '../services/api.service';

export default {
  methods: {
    applyAccessFilter(ctx: Context<any, UserAuthMeta>, useRawUsers = false) {
      const { meta } = ctx;
      if (!meta) return ctx;

      const { authUser, profile, user } = meta;

      const isAdmin = [AuthUserRole.SUPER_ADMIN, AuthUserRole.ADMIN].includes(authUser?.type);
      if (isAdmin) {
        ctx.params.sort = '-createdAt';
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
          ctx.params.sort = '-createdAt';
          return ctx;
        }

        if (useRawUsers) {
          ctx.params.query = {
            users: {
              $raw: {
                condition: `"users" @> to_jsonb(?)::jsonb`,
                bindings: [[userId]], // must be wrapped in array brackets
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

      ctx.params.sort = '-createdAt';
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
