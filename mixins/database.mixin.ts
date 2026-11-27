'use strict';

import { DatabaseMixin, DeepQueryMixin } from '@aplinkosministerija/moleculer-accounts';
import { isObject } from 'lodash';
import { ActionSchema, Context } from 'moleculer';
import filtersMixin from 'moleculer-knex-filters';
import config from '../knexfile';
import {
  andCondition,
  isSafeSortField,
  isSqlSafeJson,
  searchCondition,
  throwInvalidQuery,
} from '../modules/clientQuery';

type HiddenAction = Pick<ActionSchema, 'visibility'>;

// Bibliotekos metodai, kuriuos šis mixin'as apgaubia patikra (žr. `_parseQuery`, `_parseSort`).
const deepQuery: Record<'_parseQuery' | '_parseSort', (...args: unknown[]) => unknown> =
  DeepQueryMixin().methods;

// @moleculer/database generuojami vidiniai veiksmai — jų kūrimą galima išjungti per `createActions`.
const DATABASE_INTERNAL_ACTIONS = ['resolve', 'replace', 'createMany', 'updateMany', 'removeMany'];
// moleculer-accounts generuojami vidiniai veiksmai — kuriami visada, `createActions` vėliavų nepaiso.
const ACCOUNTS_INTERNAL_ACTIONS = ['removeAllEntities', 'populateByProp'];

// Kaskart naujas objektas: Moleculer veiksmų schemas jungia per `defaultsDeep`, kuris mutuoja šaltinį.
const internalAction = (): HiddenAction => ({ visibility: 'public' });

// API gateway (`mappingPolicy: 'all'`) pasiekia kiekvieną publikuotą veiksmą keliu
// `/<servisas>/<veiksmas>`, todėl vidiniai veiksmai be REST aliaso slepiami nuo gateway.
// Praleidžiami veiksmai, kurių servisas per `createActions` iš viso nekuria.
const hideInternalActions = (createActions: unknown): Record<string, HiddenAction> => {
  if (createActions === false) return {};

  const disabled = (createActions || {}) as Record<string, unknown>;
  const hidden: Record<string, HiddenAction> = {};

  for (const name of DATABASE_INTERNAL_ACTIONS) {
    if (disabled[name] !== false) hidden[name] = internalAction();
  }
  for (const name of ACCOUNTS_INTERNAL_ACTIONS) {
    hidden[name] = internalAction();
  }

  return hidden;
};

export const MaterializedView = {
  PUBLIC_PERMIT_SPECIES: 'publicPermitSpecies',
  PUBLIC_PERMITS_BY_CADASTRAL_IDS: 'publicPermitsByCadastralIds',
};

export default function (opts: any = {}) {
  const schema = {
    mixins: [DatabaseMixin(opts.config || config, opts), filtersMixin()],

    actions: {
      findOne: {
        visibility: 'public' as const,
        handler(ctx: Context) {
          return this.findEntity(ctx);
        },
      },
      ...hideInternalActions(opts.createActions),
    },

    // Veiksmai, kuriuose `@moleculer/database` taiko paiešką.
    hooks: {
      before: {
        list: 'groupSearch',
        find: 'groupSearch',
        count: 'groupSearch',
        all: 'groupSearch',
      },
    },

    methods: {
      // `@moleculer/database` kiekvieną paieškos lauką po pirmojo prijungia per `orWhere` be
      // skliaustų, todėl jis SQL'e atsiduria šalia visų kitų sąlygų per ARBA ir jas išjungia
      // (nuosavybės, `notDeleted`). Čia paieška paverčiama viena sugrupuota sąlyga, o bibliotekai
      // paieškos parametrai nebeperduodami.
      groupSearch(ctx: Context<any>) {
        const { search, searchFields } = ctx.params;
        delete ctx.params.search;
        delete ctx.params.searchFields;

        const condition = searchCondition(this.$fields, search, searchFields);
        if (condition) {
          ctx.params.query = andCondition(ctx.params.query, condition);
        }

        return ctx;
      },

      // `moleculer-accounts` JSON laukų (`type: 'object' | 'array'`) sąlygas į SQL įterpia kaip
      // tekstą ir ne visur ekranuoja kabutes. Sąlyga, kuri iš SQL eilutės galėtų „ištrūkti“,
      // atmetama (422) — tyliai ją išmetus užklausa grąžintų daugiau, nei prašyta. Biblioteka
      // šį metodą kviečia kiekvienam užklausos lygiui (`$and`, `$or`, `$nor`).
      _parseQuery(query: Record<string, unknown>, ...rest: unknown[]) {
        for (const [key, value] of Object.entries(query || {})) {
          const [, field] = this._replaceQueryKey(key);
          const isJsonCondition = ['array', 'object'].includes(field?.type) && isObject(value);
          if (isJsonCondition && !isSqlSafeJson(value)) throwInvalidQuery();
        }

        return deepQuery._parseQuery.call(this, query, ...rest);
      },

      // Rikiavimas pagal JSON savybę (`laukas.savybe`) bibliotekoje taip pat virsta SQL tekstu,
      // todėl laukai su kitais simboliais nei raidės, skaitmenys, `_` ir taškas praleidžiami.
      // Masyvas keičiamas vietoje: biblioteka toliau naudoja tą patį.
      _parseSort(sort: unknown[], ...rest: unknown[]) {
        sort.splice(0, sort.length, ...sort.filter(isSafeSortField));

        return deepQuery._parseSort.call(this, sort, ...rest);
      },

      async refreshMaterializedView(ctx: Context, name: string) {
        const adapter = await this.getAdapter(ctx);

        await adapter.client.schema.refreshMaterializedView(name);
        return {
          success: true,
        };
      },
    },
  };

  return schema;
}
