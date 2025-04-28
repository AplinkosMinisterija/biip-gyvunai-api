import Moleculer, { Errors } from 'moleculer';
import { User } from '../services/users.service';
import { FieldHookCallback } from './';

export enum RestrictionType {
  // DEFAULT = USER or ADMIN
  DEFAULT = 'DEFAULT',
  USER = 'USER',
  ADMIN = 'ADMIN',
  PUBLIC = 'PUBLIC',
}

export type Table<
  Fields = {},
  Populates = {},
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Pick<Omit<Fields, P> & Pick<Populates, P>, Extract<P | Exclude<keyof Fields, P>, F>>;

export interface CommonFields {
  createdBy: User['id'];
  createdAt: Date;
  updatedBy: User['id'];
  updatedAt: Date;
  deletedBy: User['id'];
  detetedAt: Date;
}

export interface CommonActionParams {
  sort?: string;
  search?: string;
  searchFields?: string[];
  pageSize?: number;
  page?: number;
}

export interface CommonPopulates {
  createdBy: User;
  updatedBy: User;
  deletedBy: User;
}

export enum Gender {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  CLARIFIED_LATER = 'CLARIFIED_LATER',
  UNIDENTIFIED = 'UNIDENTIFIED',
}

export const COMMON_FIELDS = {
  createdBy: {
    type: 'number',
    readonly: true,
    onCreate: ({ ctx }: FieldHookCallback) => ctx?.meta?.user?.id,
    populate: {
      action: 'users.resolve',
      params: {
        scope: false,
      },
    },
  },
  createdAt: {
    type: 'date',
    columnType: 'datetime',
    readonly: true,
    onCreate: () => new Date(),
  },
  updatedBy: {
    type: 'number',
    readonly: true,
    hidden: 'byDefault',
    onUpdate: ({ ctx }: FieldHookCallback) => ctx?.meta?.user?.id,
    populate: {
      action: 'users.resolve',
      params: {
        scope: false,
      },
    },
  },
  updatedAt: {
    type: 'date',
    columnType: 'datetime',
    hidden: 'byDefault',
    readonly: true,
    onUpdate: () => new Date(),
  },
  deletedBy: {
    type: 'number',
    readonly: true,
    onRemove: ({ ctx }: FieldHookCallback) => ctx?.meta?.user?.id,
    populate: {
      action: 'users.resolve',
      params: {
        scope: false,
      },
    },
  },
  deletedAt: {
    type: 'date',
    columnType: 'datetime',
    readonly: true,
    get: fieldValueForDeletedScope,
    onRemove: () => new Date(),
  },
};

export const COMMON_SCOPES = {
  notDeleted: {
    deletedAt: { $exists: false },
  },
  deleted: {
    deletedAt: { $exists: true },
  },
};

export const COMMON_PAGINATION_PARAMS = {
  pageSize: {
    type: 'number',
    convert: true,
    integer: true,
    optional: true,
    default: 10,
    min: 1,
  },
  page: {
    type: 'number',
    convert: true,
    integer: true,
    min: 1,
    optional: true,
    default: 1,
  },
};

export const COMMON_ACTION_PARAMS = {
  sort: {
    type: 'string',
    optional: true,
  },
};

export const COMMON_DEFAULT_SCOPES = ['notDeleted'];
export const COMMON_DELETED_SCOPES = ['-notDeleted', 'deleted'];

export function throwNoRightsError(message?: string): Errors.MoleculerError {
  throw new Moleculer.Errors.MoleculerClientError(message || `No rights.`, 401, 'NO_RIGHTS');
}
export function throwNotFoundError(message?: string, data?: any): Errors.MoleculerError {
  throw new Moleculer.Errors.MoleculerClientError(message || `Not found.`, 404, 'NOT_FOUND', data);
}
export function throwBadRequestError(message?: string): Errors.MoleculerError {
  throw new Moleculer.Errors.MoleculerClientError(message || `bad request.`, 400, 'BAD_REQUEST');
}

export function throwValidationError(message?: string): Errors.MoleculerError {
  throw new Moleculer.Errors.ValidationError(message || `Not valid.`, 'VALIDATION_ERROR');
}

export const GroupByType = {
  MUNICIPALITY: 'MUNICIPALITY',
  MUNICIPALITY_AND_SPECIES_CLASSIFIER: 'MUNICIPALITY_AND_SPECIES_CLASSIFIER',
};

export type DeepService = {
  _joinField: any;
  _getPrimaryKeyColumnName: any;
  _getSelectFields: any;
  _getServiceQuery: (knex: any) => any;
};

export type DeepQuery = {
  knex: any;
  q: any;
  tableName: string;
  subTableName: string;
  fields: string[];
  field: string;
  depth: number;
  deeper: any;
  withQuery: any;
  getService: (serviceOrName: string | DeepService) => DeepService;
  serviceFields: (serviceOrName: string | DeepService) => Record<string, string>;
  serviceQuery: (serviceOrName: string | DeepService) => any;
  leftJoinService: (serviceOrName: string | DeepService, column1: string, column2: string) => any;
};

export function fieldValueForDeletedScope({ ctx, value }: any) {
  if (!ctx?.params?.scope) return;
  let scope = ctx.params.scope;
  if (!Array.isArray(scope)) {
    scope = scope.split(',');
  }

  if (!scope.includes('deleted')) return;
  return value;
}
