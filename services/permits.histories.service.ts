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

enum DeleteReasons {
  NON_COMPLIANCE = 'NON_COMPLIANCE',
  REQUESTED_CANCELLATION = 'REQUESTED_CANCELLATION',
  ENTITY_DISSOLVED = 'ENTITY_DISSOLVED',
  HOLDER_DECEASED = 'HOLDER_DECEASED',
  DISEASE_OUTBREAK = 'DISEASE_OUTBREAK',
  NO_ANIMALS_FOR_YEAR = 'NO_ANIMALS_FOR_YEAR',
  INSUFFICIENT_SPACE = 'INSUFFICIENT_SPACE',
  NO_ANIMALS_INTRODUCED = 'NO_ANIMALS_INTRODUCED',
  FRAUDULENT_INFO = 'FRAUDULENT_INFO',
  EXPIRED = 'EXPIRED',
  OTHER = 'OTHER',
}

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
      deleteReason: {
        type: 'string',
        enum: Object.values(DeleteReasons),
      },
      deleteOtherReason: 'string',
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },
})
export default class PermitHistoriesService extends moleculer.Service {}
