'use strict';

import moleculer from 'moleculer';
import { Service } from 'moleculer-decorators';

import DbConnection from '../mixins/database.mixin';
import { COMMON_DEFAULT_SCOPES, COMMON_FIELDS, COMMON_SCOPES } from '../types';

// AAD sprendimai (#85, 27 ir 33 kl. a): įrašo taisymai ir anuliavimas saugomi su priežastimi.
export const RecordHistoryTypes = {
  UPDATED: 'UPDATED',
  ANNULLED: 'ANNULLED',
};

@Service({
  name: 'records.histories',

  mixins: [
    DbConnection({
      collection: 'recordHistories',
      rest: false,
      actionVisibility: 'public',
    }),
  ],

  settings: {
    fields: {
      id: {
        type: 'string',
        columnType: 'integer',
        primaryKey: true,
        secure: true,
      },
      type: {
        type: 'string',
        enum: Object.values(RecordHistoryTypes),
      },
      record: {
        type: 'number',
        columnType: 'integer',
        columnName: 'recordId',
        required: true,
        immutable: true,
      },
      reason: 'string',
      // Pakeisti laukai: { laukas: { old, new } }.
      changes: {
        type: 'object',
        raw: true,
      },
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },
})
export default class RecordHistoriesService extends moleculer.Service {}
