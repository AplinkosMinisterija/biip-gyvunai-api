'use strict';

import { DatabaseMixin } from '@aplinkosministerija/moleculer-accounts';
import { ActionSchema, Context } from 'moleculer';
import filtersMixin from 'moleculer-knex-filters';
import config from '../knexfile';

type HiddenAction = Pick<ActionSchema, 'visibility'>;

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

    methods: {
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
