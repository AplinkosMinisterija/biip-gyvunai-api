import { Context } from 'moleculer';
import { AuthUserRole, UserAuthMeta } from '../services/api.service';

type ProcessedField = { name: string; virtual?: boolean };

const isRealColumn = (fields: ProcessedField[] | undefined, fieldName: string): boolean =>
  !!fields?.some((field) => field.name === fieldName && !field.virtual);

export default {
  methods: {
    // Leidžia rūšiuoti tik pagal realias (ne virtualias) lenteles kolonas —
    // kitaip knex sugeneruoja `"user"."firstName"` tipo SQL ir užklausa lūžta.
    sanitizeSort(sort?: string | string[]): string[] | undefined {
      if (!sort) return undefined;

      const items = Array.isArray(sort)
        ? sort
        : String(sort).replace(/,/g, ' ').split(' ').filter(Boolean);

      const sortable = items.filter((item) => this.isSortableField(String(item).replace(/^-/, '')));

      return sortable.length ? sortable : undefined;
    },

    isSortableField(fieldName: string): boolean {
      const [rootField, ...nestedParts] = fieldName.split('.');

      if (!nestedParts.length) {
        return isRealColumn(this.$fields, fieldName);
      }

      // Taškuotas raktas (pvz. `speciesClassifier.name`) rūšiuoja per susijusią
      // lentelę — leidžiama tik kai šakninis laukas turi service tipo `deepQuery`
      // (tada moleculer-accounts DeepQueryMixin pats prijungia lentelę), o likusi
      // dalis yra reali to serviso kolona.
      if (nestedParts.length !== 1) return false;

      const deepQuery = this.settings?.fields?.[rootField]?.deepQuery;
      const serviceName = typeof deepQuery === 'string' ? deepQuery : deepQuery?.service;
      if (typeof serviceName !== 'string') return false;

      const service = this.broker?.getLocalService(serviceName);
      return isRealColumn(service?.$fields, nestedParts[0]);
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
