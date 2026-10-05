import { Context } from 'moleculer';
import { AuthUserRole, UserAuthMeta } from '../services/api.service';

type ProcessedField = { name: string; virtual?: boolean };
type AccessQuery = Record<string, unknown>;

const OWNERSHIP_FIELDS = ['tenant', 'user'] as const;

const isRealColumn = (fields: ProcessedField[] | undefined, fieldName: string): boolean =>
  !!fields?.some((field) => field.name === fieldName && !field.virtual);

const isAdminMeta = (meta?: UserAuthMeta): boolean =>
  [AuthUserRole.SUPER_ADMIN, AuthUserRole.ADMIN].includes(meta?.authUser?.type);

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

    // Užklausos sąlyga, ribojanti įrašus iki naudotojo (ar jo profilio) nuosavybės.
    // `null` — apribojimo nėra: administratorius arba vidinis kvietimas be naudotojo konteksto.
    buildAccessQuery(meta: UserAuthMeta | undefined, useRawUsers = false): AccessQuery | null {
      if (!meta || isAdminMeta(meta)) return null;

      const { profile, user } = meta;

      if (profile && user) {
        return { tenant: profile };
      }

      if (!profile && user) {
        const userId = Number(user.id);

        if (!userId) {
          return { $raw: { condition: 'FALSE', bindings: [] } };
        }

        if (useRawUsers) {
          return {
            users: {
              $raw: {
                condition: `"users" @> to_jsonb(?::int[])`,
                bindings: [[userId]],
              },
            },
          };
        }

        return { user: userId };
      }

      return null;
    },

    applyAccessFilter(ctx: Context<any, UserAuthMeta>, useRawUsers = false) {
      const { meta } = ctx;
      if (!meta) return ctx;

      ctx.params.sort = this.sanitizeSort(ctx.params.sort) || '-createdAt';

      const accessQuery = this.buildAccessQuery(meta, useRawUsers);
      if (accessQuery) {
        ctx.params.query = {
          ...accessQuery,
          ...(ctx.params.query || {}),
        };
      }

      return ctx;
    },

    beforeSelect(ctx: Context<any, UserAuthMeta>) {
      return this.applyAccessFilter(ctx, false);
    },

    beforeSelectPermit(ctx: Context<any, UserAuthMeta>) {
      return this.applyAccessFilter(ctx, true);
    },

    // Prieš update/replace/remove: svetimas įrašas ne savininkui „neegzistuoja" (404),
    // lygiai kaip ir per `get`. Rastas įrašas paliekamas `ctx.locals.entity`
    // tolesniems hook'ams (pvz. `remove` grąžina tik id).
    async beforeMutate(
      ctx: Context<Record<string, unknown> & { id: number | string }, UserAuthMeta>,
    ) {
      const accessQuery = this.buildAccessQuery(ctx.meta) || {};

      const entity = await this.resolveEntities(
        ctx,
        { id: ctx.params.id, query: accessQuery },
        { throwIfNotExist: true },
      );

      if (!isAdminMeta(ctx.meta)) {
        // Savininkystės laukus gali keisti tik administratorius.
        for (const field of OWNERSHIP_FIELDS) {
          if (ctx.params[field] === undefined) continue;
          if (entity[field] == null) delete ctx.params[field];
          else ctx.params[field] = entity[field];
        }
      }

      ctx.locals.entity = entity;
      return ctx;
    },
  },
};
