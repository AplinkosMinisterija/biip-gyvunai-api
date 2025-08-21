'use strict';

import moleculer from 'moleculer';
import { Service } from 'moleculer-decorators';

import DbConnection from '../mixins/database.mixin';
import { COMMON_DEFAULT_SCOPES, COMMON_FIELDS, COMMON_SCOPES } from '../types';

export const PermitHistoryTypes = {
  CREATED: 'CREATED',
  UPDATED: 'UPDATED',
  DELETED: 'DELETED',
};

@Service({
  name: 'permits.histories',

  mixins: [
    DbConnection({
      collection: 'permitHistories',
      rest: false,
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
        enum: Object.values(PermitHistoryTypes),
      },
      permit: {
        type: 'number',
        columnType: 'integer',
        columnName: 'permitId',
        required: true,
        immutable: true,
        populate: 'permits.resolve',
      },
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },
})
export default class PermitHistoriesService extends moleculer.Service {}
