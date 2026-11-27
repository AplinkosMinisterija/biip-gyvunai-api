import Moleculer, { Errors } from 'moleculer';
import { andCondition, parseQuery, scopeCondition } from '../modules/clientQuery';
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

// Sritis užklausoje nurodoma masyvu arba eilute, atskirta kableliais ar tarpais.
const isScopeRequested = (scope: unknown, name: string): boolean =>
  (Array.isArray(scope) ? scope : String(scope ?? '').split(/[,\s]+/)).includes(name);

// Sritys rašomos funkcijomis, kad kliento užklausa jų neišjungtų (žr. modules/clientQuery.ts).
// Paprašius srities `deleted` (ją per API gali nurodyti tik administratorius), numatytoji
// `notDeleted` netaikoma — kitaip abi sąlygos kartu nieko negrąžintų.
export const COMMON_SCOPES = {
  notDeleted: (query: unknown, _ctx?: unknown, params?: { scope?: unknown }) =>
    isScopeRequested(params?.scope, 'deleted')
      ? parseQuery(query)
      : andCondition(query, { deletedAt: { $exists: false } }),
  deleted: scopeCondition({ deletedAt: { $exists: true } }),
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

// Rūšies grupės dydžio apskaitos vienetai; seni įrašai be vieneto laikomi vienetais.
export enum Units {
  UNIT = 'UNIT',
  KG = 'KG',
}

export const COMMON_DEFAULT_SCOPES = ['notDeleted'];
export const COMMON_DELETED_SCOPES = ['-notDeleted', 'deleted'];

// Leidimą išduoda AAD, todėl turėtojas savo leidime gali papildyti tik aptvėrimo duomenis
// (išorinės sistemos forma „Atnaujinti“); kitus laukus keičia tik administratorius.
export const PERMIT_FIELDS_EDITABLE_BY_HOLDER = [
  'fencingOffDate',
  'fencingOffStartDate',
  'fencedArea',
] as const;

// Leidimo nuosavybės laukai: juos nustato tik administratorius.
export const PERMIT_OWNERSHIP_FIELDS = ['tenant', 'users'] as const;

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
};

export function fieldValueForDeletedScope({ ctx, value }: any) {
  if (!isScopeRequested(ctx?.params?.scope, 'deleted')) return;
  return value;
}

export enum RecordType {
  ACQUIREMENT = 'ACQUIREMENT',
  BIRTH = 'BIRTH',
  DEATH = 'DEATH',
  VACCINATION = 'VACCINATION',
  SALE = 'SALE',
  TREATMENT = 'TREATMENT',
  MARKING = 'MARKING',
  PICK_UP_FROM_NATURE = 'PICK_UP_FROM_NATURE',
  OBTAINMENT_OF_FOSTERED_ANIMAL = 'OBTAINMENT_OF_FOSTERED_ANIMAL',
  RELEASE = 'RELEASE',
  TRANSFER = 'TRANSFER',
  GENDER_CONFIRMATION = 'GENDER_CONFIRMATION',
  CERTIFICATE_NO = 'CERTIFICATE_NO',
  OTHER = 'OTHER',
}
