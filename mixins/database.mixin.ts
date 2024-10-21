'use strict';

import { DatabaseMixin } from '@aplinkosministerija/moleculer-accounts';
import filtersMixin from 'moleculer-knex-filters';
import config from '../knexfile';

export default function (opts: any = {}) {
  const schema = {
    mixins: [DatabaseMixin(opts.config || config, opts), filtersMixin()],

    actions: {
      findOne(ctx: any) {
        return this.findEntity(ctx);
      },
    },
  };

  return schema;
}
