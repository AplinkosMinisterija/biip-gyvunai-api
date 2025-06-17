'use strict';

import { DatabaseMixin } from '@aplinkosministerija/moleculer-accounts';
import { Context } from 'moleculer';
import filtersMixin from 'moleculer-knex-filters';
import config from '../knexfile';

export const MaterializedView = {
  PUBLIC_PERMIT_SPECIES: 'publicPermitSpecies',
  PUBLIC_PERMITS_BY_CADASTRAL_IDS: 'publicPermitsByCadastralIds',
};

export default function (opts: any = {}) {
  const schema = {
    mixins: [DatabaseMixin(opts.config || config, opts), filtersMixin()],

    actions: {
      findOne(ctx: any) {
        return this.findEntity(ctx);
      },
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
