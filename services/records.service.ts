'use strict';

import moleculer, { Context, RestSchema } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';

import ApiGateway from 'moleculer-web';
import DbConnection from '../mixins/database.mixin';
import ProfileMixin from '../mixins/profile.mixin';
import { latestRecordByDate } from '../modules/latestRecord';
import { diffRecord, RECORD_DATE_FIELDS, RecordEditableField } from '../modules/recordChanges';
import { isLateEventDate, recordEventDate, resolveLateness } from '../modules/recordLateness';
import {
  AMOUNT_RECORD_TYPES,
  calculateGroupAmount,
  OUTGOING_RECORD_TYPES,
} from '../modules/speciesAmount';
import {
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  CommonFields,
  CommonPopulates,
  Gender,
  isAdmin,
  RecordType,
  Table,
} from '../types';
import { Animal } from './animals.service';
import { AuthUserRole, UserAuthMeta } from './api.service';
import { FosteredAnimal } from './fosteredAnimals.service';
import { MarkingTypeClassifier } from './markingTypeClassifiers.service';
import { Permit } from './permits.service';
import { RecordHistoryTypes } from './records.histories.service';
import { AccountingType, Species } from './species.service';
import { SpeciesClassifier } from './speciesClassifiers.service';
import { Tenant } from './tenants.service';
import { User } from './users.service';

// RecordType gyvena types/constants.ts (naudoja ir modules/speciesAmount.ts) — čia re-eksportuojamas,
// kad esami importai iš records.service nesikeistų.
export { RecordType };

export enum DeathReason {
  EUTHANIZED = 'EUTHANIZED',
  FOUND_DEAD = 'FOUND_DEAD',
}

export enum LegalForm {
  LEGAL_ENTITY = 'LEGAL_ENTITY',
  INDIVIDUAL = 'INDIVIDUAL',
}

export enum NationalityType {
  LOCAL = 'LOCAL',
  FOREIGN = 'FOREIGN',
}

const recordPropertyNames: { [key: string]: string } = {
  [RecordType.BIRTH]: 'birthRecord',
  [RecordType.DEATH]: 'deathRecord',
  [RecordType.SALE]: 'saleRecord',
  [RecordType.ACQUIREMENT]: 'acquirementRecord',
};

interface Fields extends CommonFields {
  id: number;
  animal: Animal['id'];
  permit: Permit['id'];
  species: Species['id'];
  fosteredAnimal: FosteredAnimal['id'];
  speciesClassifier: SpeciesClassifier['id'];
  type: RecordType;
  date: string;
  certificateNo: string;
  numberOfAnimals: number;
  note: string;
  deathReason: DeathReason;
  markingNumber: string;
  markingType: MarkingTypeClassifier['id'];
  file: any;
  acquiredFrom: {
    type: LegalForm;
    nationalityType: NationalityType;
    name: string;
    code?: string;
    address?: string;
    permitNumber?: string;
    permitIssueDate?: string;
    permitIssuer?: string;
  };
  acquireDate: string;
  vetExaminationDate: string;
  markingDate: string;
  municipality: any;
  transferRecipient: {
    type: LegalForm;
    address: string;
    phone: string;
    email: string;
  };
  tenant: Tenant['id'];
  user: User['id'];
  annulledAt: Date;
  annulledBy: User['id'];
  annulReason: string;
  isLate: boolean;
  lateReason: string;
}

interface Populates extends CommonPopulates {
  speciesClassifier: SpeciesClassifier;
  species: Species;
  permits: Permit;
  user: User;
  tenant: Tenant;
  markingType: MarkingTypeClassifier;
}

export type Record<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

// Servisai, kurie registruodami gyvūną patys nustato įrašo vėlavimą.
const LATENESS_SET_BY_CALLER = ['animals', 'fosteredAnimals'];

const throwInvalidNumberOfAnimals = () => {
  throw new moleculer.Errors.MoleculerClientError(
    'Invalid number of animals',
    422,
    'INVALID_NUMBER_OF_ANIMALS',
  );
};

@Service({
  name: 'records',
  mixins: [DbConnection(), ProfileMixin],
  settings: {
    // Ryšiai su leidimu, rūšimi, gyvūnu ir klasifikatoriumi užpildomi su scope: false — panaikinto
    // leidimo duomenis AAD peržiūri tik skaitymui (#85, 5 kl.), o sujungto klasifikatoriaus
    // pavadinimas neturi dingti.
    fields: {
      id: {
        type: 'string',
        columnType: 'integer',
        primaryKey: true,
        secure: true,
      },
      animal: {
        type: 'number',
        convert: true,
        columnType: 'integer',
        columnName: 'animalId',
        required: false,
        populate: {
          action: 'animals.resolve',
          params: { scope: false },
        },
      },
      permit: {
        type: 'number',
        convert: true,
        columnType: 'integer',
        columnName: 'permitId',
        required: false,
        populate: {
          action: 'permits.resolve',
          params: { scope: false },
        },
      },
      species: {
        type: 'number',
        convert: true,
        columnType: 'integer',
        columnName: 'speciesId',
        required: false,
        populate: {
          action: 'species.resolve',
          params: { scope: false },
        },
      },
      fosteredAnimal: {
        type: 'number',
        columnType: 'integer',
        columnName: 'fosteredAnimalId',
        required: false,
        populate: {
          action: 'fosteredAnimals.resolve',
          params: { scope: false },
        },
      },
      speciesClassifier: {
        type: 'number',
        columnType: 'integer',
        columnName: 'speciesClassifierId',
        deepQuery: 'speciesClassifiers',
        populate: {
          action: 'speciesClassifiers.resolve',
          params: { scope: false },
        },
      },
      type: {
        type: 'string',
        required: true,
        enum: Object.values(RecordType),
      },
      gender: {
        type: 'string',
        enum: [Gender.MALE, Gender.FEMALE],
      },
      date: 'string',
      certificateNo: 'string',
      numberOfAnimals: 'number',
      note: 'string',
      deathReason: 'string',
      markingNumber: 'string',
      // AAD sprendimas (#85, 12 kl.): kiekvienas ženklinimas turi savo pažymos numerį.
      markingCertificateNo: 'string',
      // AAD sprendimas (#85, 13 kl.): vakcinos pavadinimas, neprivalomas.
      vaccineName: 'string',
      markingType: {
        type: 'number',
        columnType: 'integer',
        columnName: 'markingTypeId',
        populate: {
          action: 'markingTypeClassifiers.resolve',
        },
      },
      file: 'array',
      acquiredFrom: {
        type: 'object',
        raw: true,
        required: false,
        properties: {
          type: 'string',
          nationalityType: 'string',
          name: 'string',
          code: 'string',
          address: 'string',
          permitNumber: 'string',
          permitIssueDate: 'string',
          permitIssuer: 'string',
        },
      },
      acquireDate: 'string',
      vetExaminationDate: 'string',
      markingDate: 'string',
      municipality: 'object',
      transferRecipient: 'object',
      tenant: {
        type: 'number',
        columnType: 'integer',
        columnName: 'tenantId',
        populate: {
          action: 'tenants.resolve',
          params: {
            scope: false,
          },
        },
      },
      user: {
        type: 'number',
        columnType: 'integer',
        columnName: 'userId',
        populate: {
          action: 'users.resolve',
          params: {
            scope: false,
          },
        },
      },
      // AAD sprendimas (#85, 33 kl. a): įrašų niekas netrina — jie anuliuojami nurodžius
      // priežastį. Laukus nustato tik veiksmas `annul`.
      annulledAt: {
        type: 'date',
        columnType: 'datetime',
        readonly: true,
      },
      annulledBy: {
        type: 'number',
        readonly: true,
        populate: {
          action: 'users.resolve',
          params: {
            scope: false,
          },
        },
      },
      annulReason: {
        type: 'string',
        readonly: true,
      },
      // AAD sprendimai (#85, 25 kl., 34 kl. a): vėliau nei per 7 d. nuo įvykio įvestas ar
      // laikytojo patikslintas įrašas visam laikui pažymimas. Abu laukus nustato tik serveris
      // (`beforeCreate`, `edit`), kliento reikšmės perrašomos.
      isLate: {
        type: 'boolean',
        default: false,
      },
      lateReason: 'string',
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
      notAnnulled: {
        annulledAt: { $exists: false },
      },
    },
    // Anuliuotas įrašas neskaičiuojamas niekur (kiekis, gyvūno būsena, sertifikatas,
    // ženklinimas), nes visi skaičiavimai įrašus ima su numatytosiomis sritimis.
    defaultScopes: [...COMMON_DEFAULT_SCOPES, 'notAnnulled'],
    // Laukai, kurių apribotas naudotojas keisti negali (žr. ProfileMixin.beforeMutate).
    userImmutableFields: [
      'species',
      'animal',
      'fosteredAnimal',
      'permit',
      'speciesClassifier',
      'type',
      'numberOfAnimals',
    ],
    defaultPopulates: ['markingType'],
  },
  hooks: {
    before: {
      newRecord: ['beforeCreate'],
      list: ['beforeSelect', 'handleFilters', 'includeAnnulled'],
      find: ['beforeSelect', 'handleFilters'],
      count: ['beforeSelect', 'handleFilters'],
      get: ['beforeSelect', 'handleFilters', 'includeAnnulled'],
      all: ['beforeSelect', 'handleFilters'],
      update: ['beforeMutate', 'validateChangedNumberOfAnimals'],
      replace: ['beforeMutate', 'validateChangedNumberOfAnimals'],
      remove: ['beforeMutate', 'validateRemovedNumberOfAnimals'],
    },
    after: {
      // Perskaičiavimas pirmas: laiško siuntimo klaida neturi palikti pasenusio kiekio.
      create: ['recalculateSpeciesAmount', 'syncCurrentCertificate', 'afterCreate'],
      update: ['recalculateSpeciesAmount', 'syncCurrentCertificate'],
      remove: ['recalculateSpeciesAmount', 'syncCurrentCertificate'],
    },
  },
  actions: {
    create: {
      rest: null,
      visibility: 'public',
    },
    // Įrašų niekas netrina (#85, 33 kl. a) — vietoj to `annul`.
    remove: {
      rest: null,
      visibility: 'public',
    },
    // Taisoma tik nurodžius priežastį (#85, 27 kl. a) — per `edit` (PATCH /records/:id).
    update: {
      rest: null,
      visibility: 'public',
    },
  },
})
export default class RecordsService extends moleculer.Service {
  @Action({
    rest: 'POST /',
    params: {
      animal: 'number|convert|optional',
      species: 'number|convert|optional',
      fosteredAnimal: 'number|convert|optional',
      type: {
        type: 'string',
        enum: Object.values(RecordType),
      },
      gender: {
        type: 'string',
        enum: [Gender.MALE, Gender.FEMALE],
        optional: true,
      },
      date: 'string|optional',
      numberOfAnimals: 'number|convert|integer|min:0|optional',
      note: 'string|optional',
      deathReason: 'string|optional',
      acquiredFrom: 'object|optional',
      acquireDate: 'string|optional',
      municipality: 'object|optional',
      transferRecipient: 'object|optional',
      vaccineName: 'string|optional',
      markingCertificateNo: 'string|optional',
      lateReason: 'string|optional',
    },
  })
  async newRecord(ctx: Context<any>) {
    const params = ctx.params;
    if (params?.type === RecordType.GENDER_CONFIRMATION) {
      await ctx.call('animals.update', { id: params?.animal, gender: params.gender });
    }

    return ctx.call('records.create', params);
  }

  // AAD sprendimas (#85, 33 kl. a): įrašų niekas netrina — laikytojas ir AAD įrašą anuliuoja
  // nurodę priežastį. Anuliuotas įrašas lieka matomas, bet kiekis, gyvūno būsena ir kortelės
  // numeriai perskaičiuojami be jo.
  @Action({
    rest: 'POST /:id/annul',
    params: {
      id: { type: 'number', convert: true },
      reason: { type: 'string', trim: true, empty: false },
    },
  })
  async annul(ctx: Context<{ id: number; reason: string }, UserAuthMeta>) {
    const record = await this.findAccessibleRecord(ctx);
    if (record.annulledAt) {
      throw new moleculer.Errors.MoleculerClientError(
        'Record is already annulled',
        422,
        'RECORD_ANNULLED',
      );
    }
    // Anuliavimas skaičiuojamas kaip įrašo pašalinimas: įsigijimo neanuliuosi, jei dalis
    // gyvūnų jau išėjo.
    await this.assertStockAfterChange(ctx, record);

    // Sąlyginis atnaujinimas: iš dviejų vienu metu siųstų anuliavimų įrašomas tik vienas.
    const now = new Date();
    const userId = ctx.meta.user?.id ?? null;
    const adapter = await this.getAdapter(ctx);
    const updated = await adapter
      .client('records')
      .where({ id: record.id })
      .whereNull('annulledAt')
      .whereNull('deletedAt')
      .update({
        annulledAt: now,
        annulledBy: userId,
        annulReason: ctx.params.reason,
        updatedAt: now,
        updatedBy: userId,
      });
    if (!updated) {
      throw new moleculer.Errors.MoleculerClientError(
        'Record is already annulled',
        422,
        'RECORD_ANNULLED',
      );
    }

    // Istorija įrašoma pirma — perskaičiavimo klaida neturi palikti anuliavimo be priežasties.
    await this.createRecordHistory(ctx, record.id, RecordHistoryTypes.ANNULLED, ctx.params.reason);

    const annulled: Record = await this.resolveEntities(ctx, {
      id: record.id,
      scope: '-notAnnulled',
    });
    ctx.locals.entity = record;
    await this.recalculateSpeciesAmount(ctx, annulled);
    await this.syncCurrentCertificate(ctx, annulled);

    return annulled;
  }

  // AAD sprendimas (#85, 27 kl. a): laikytojas ir AAD taiso įrašo duomenis nurodę priežastį,
  // pakeisti laukai (buvusi ir nauja reikšmė) saugomi istorijoje. Tipas, gyvūnas, rūšis ir
  // leidimas nekeičiami: klaidingą įrašą reikia anuliuoti ir įvesti naują.
  @Action({
    rest: 'PATCH /:id',
    params: {
      id: { type: 'number', convert: true },
      reason: { type: 'string', trim: true, empty: false },
      date: 'string|optional',
      numberOfAnimals: 'number|convert|integer|min:0|optional',
      note: 'string|optional',
      certificateNo: 'string|optional',
      markingNumber: 'string|optional',
      markingCertificateNo: 'string|optional',
      markingType: 'number|convert|optional',
      markingDate: 'string|optional',
      acquiredFrom: 'object|optional',
      acquireDate: 'string|optional',
      transferRecipient: 'object|optional',
      municipality: 'object|optional',
      vaccineName: 'string|optional',
      deathReason: 'string|optional',
      vetExaminationDate: 'string|optional',
      file: 'array|optional',
    },
  })
  async edit(ctx: Context<{ id: number; reason: string; [field: string]: unknown }, UserAuthMeta>) {
    const record = await this.findAccessibleRecord(ctx);
    if (record.annulledAt) {
      throw new moleculer.Errors.MoleculerClientError(
        'An annulled record cannot be changed',
        422,
        'RECORD_ANNULLED',
      );
    }

    const invalidDate = RECORD_DATE_FIELDS.find(
      (field) => ctx.params[field] && Number.isNaN(new Date(ctx.params[field] as string).getTime()),
    );
    if (invalidDate) {
      throw new moleculer.Errors.MoleculerClientError(
        `Invalid ${invalidDate}`,
        422,
        'INVALID_DATE',
      );
    }

    const changes = diffRecord(record, ctx.params);
    // Kiekis taisomas tik grupinės apskaitos kiekį keičiančiame įraše — kitur jis nenaudojamas.
    if (changes.numberOfAnimals && !(await this.usesGroupAmount(ctx, record))) {
      delete changes.numberOfAnimals;
    }
    const changedFields = Object.keys(changes) as RecordEditableField[];
    if (!changedFields.length) return record;

    if (changes.numberOfAnimals) {
      await this.assertStockAfterChange(ctx, record, {
        species: record.species,
        type: record.type,
        numberOfAnimals: Number(changes.numberOfAnimals.new),
      });
    }

    // Įrašoma ta pati (sutvarkyta) reikšmė, kuri saugoma istorijoje.
    // Laikytojo patikslintas įrašas, kai nuo įvykio praėjo daugiau nei 7 d., pažymimas
    // vėluojančiu (#85, 25 kl.); priežastis — taisymo priežastis. AAD taisymai jo nežymi.
    const changed = Object.fromEntries(changedFields.map((field) => [field, changes[field].new]));
    const markLate =
      !isAdmin(ctx) &&
      !record.isLate &&
      (isLateEventDate(recordEventDate(record)) ||
        isLateEventDate(recordEventDate({ ...record, ...changed })));

    const updated: Record = await this.updateEntity(ctx, {
      id: record.id,
      ...changed,
      ...(markLate ? { isLate: true } : {}),
    });

    await this.createRecordHistory(
      ctx,
      record.id,
      RecordHistoryTypes.UPDATED,
      ctx.params.reason,
      changes,
    );

    ctx.locals.entity = record;
    await this.recalculateSpeciesAmount(ctx, updated);
    await this.syncCurrentCertificate(ctx, updated);

    return updated;
  }

  @Method
  async usesGroupAmount(ctx: Context<unknown, UserAuthMeta>, record: Record): Promise<boolean> {
    if (!record.species || !AMOUNT_RECORD_TYPES.includes(record.type)) return false;
    const species: Species = await ctx.call('species.resolve', { id: record.species });
    return !!species && species.type !== AccountingType.INDIVIDUAL;
  }

  @Action({
    rest: 'GET /:id/history',
    params: {
      id: { type: 'number', convert: true },
      page: { type: 'number', convert: true, integer: true, min: 1, optional: true },
      pageSize: { type: 'number', convert: true, integer: true, min: 1, optional: true },
    },
  })
  async getHistory(ctx: Context<{ id: number; page?: number; pageSize?: number }, UserAuthMeta>) {
    await this.findAccessibleRecord(ctx);

    return ctx.call('records.histories.list', {
      sort: '-createdAt',
      query: { record: ctx.params.id },
      page: ctx.params.page,
      pageSize: ctx.params.pageSize,
      populate: 'createdBy',
    });
  }

  // Laikytojui pasiekiami tik jo (ar jo įmonės) įrašai, kaip per `beforeMutate`; svetimas
  // įrašas jam „neegzistuoja“ (404). Randamas ir anuliuotas įrašas.
  @Method
  async findAccessibleRecord(ctx: Context<{ id: number }, UserAuthMeta>): Promise<Record> {
    const accessQuery = this.buildAccessQuery(ctx.meta);
    return this.resolveEntities(
      ctx,
      { id: ctx.params.id, query: accessQuery || {}, scope: '-notAnnulled' },
      { throwIfNotExist: true },
    );
  }

  @Method
  createRecordHistory(
    ctx: Context<unknown, UserAuthMeta>,
    record: Record['id'],
    type: string,
    reason: string,
    changes?: object,
  ) {
    return ctx.call('records.histories.create', { record, type, reason, changes });
  }

  // Žurnale anuliuoti įrašai rodomi su žyma, todėl sąrašas ir peržiūra juos grąžina.
  // Administratoriaus `scope: false` ir taip išjungia visas numatytąsias sritis.
  @Method
  includeAnnulled(ctx: Context<any>) {
    const { scope } = ctx.params;
    if (scope === false || scope === 'false') return ctx;

    // Kaip `sanitizeParams`: eilutė gali turėti kelias sritis, atskirtas kableliais ar tarpais.
    const scopes =
      !scope || scope === true || scope === 'true'
        ? []
        : Array.isArray(scope)
        ? scope
        : String(scope)
            .split(/[,\s]+/)
            .filter(Boolean);
    ctx.params.scope = [...scopes, '-notAnnulled'];
    return ctx;
  }

  // Žurnale įvedamo įrašo įvykio data privaloma (kaip išorinės sistemos formoje), kitaip
  // vėlavimo patikra būtų apeinama. Data neprivaloma tik įrašui „Kita“.
  @Method
  requireEventDate(params: Partial<Record>) {
    const eventDate = recordEventDate(params);
    if (!eventDate && params.type === RecordType.OTHER) return eventDate;
    if (!eventDate || Number.isNaN(new Date(eventDate).getTime())) {
      throw new moleculer.Errors.MoleculerClientError(
        'A valid event date is required',
        422,
        'INVALID_DATE',
      );
    }
    return eventDate;
  }

  @Method
  async beforeCreate(ctx: Context<any, UserAuthMeta>) {
    let entityTenant;
    let entityUser;
    if (ctx.params.animal) {
      const animal: any = await ctx.call('animals.findOne', {
        query: {
          id: ctx.params.animal,
        },
      });

      if (!animal) {
        throw new moleculer.Errors.MoleculerClientError('Animal not found', 422, 'INVALID_ANIMAL');
      }
      entityTenant = animal.tenant;
      entityUser = animal.user;
      const method = recordPropertyNames[ctx.params.type];
      if (animal[method]) {
        throw new moleculer.Errors.MoleculerClientError(
          'Invalid record type',
          422,
          'INVALID_RECORD_TYPE',
        );
      }
    }
    if (ctx.params.species) {
      const species: Species = await ctx.call('species.findOne', {
        query: {
          id: ctx.params.species,
        },
      });

      if (!species) {
        throw new moleculer.Errors.MoleculerClientError(
          'Species not found',
          422,
          'INVALID_SPECIES',
        );
      }
      entityTenant = species.tenant;
      entityUser = species.user;
      ctx.params.permit = species.permit;
      ctx.params.speciesClassifier = species.speciesClassifier;
      this.validateNumberOfAnimals(species, ctx.params.type, ctx.params.numberOfAnimals);
    }

    if (ctx.params.fosteredAnimal) {
      const fosteredAnimal: FosteredAnimal = await ctx.call('fosteredAnimals.findOne', {
        query: {
          id: ctx.params.fosteredAnimal,
        },
      });
      if (!fosteredAnimal) {
        throw new moleculer.Errors.MoleculerClientError(
          'Fostered animal not found',
          422,
          'INVALID_FOSTERED_ANIMAL',
        );
      }
      entityTenant = fosteredAnimal.tenant;
      entityUser = fosteredAnimal.user;
      ctx.params.speciesClassifier = fosteredAnimal.speciesClassifier;
    }

    if (
      ![AuthUserRole.ADMIN, AuthUserRole.SUPER_ADMIN].some(
        (role) => role === ctx.meta.authUser.type,
      )
    ) {
      const profile = ctx.meta.profile;
      const userId = ctx.meta.user.id;
      const isTenantRecord = !!profile && !!entityTenant && entityTenant == profile;
      const isUserRecord = !!userId && !!entityUser && entityUser == userId;
      if (!isTenantRecord && !isUserRecord) {
        throw new ApiGateway.Errors.UnAuthorizedError('NO_RIGHTS', {
          error: 'Unauthorized',
        });
      }
    }

    // Gyvūną registruojantis servisas vėlavimą nustato pats pagal registracijos įvykį
    // (įsigijimą ar gimimą): kartu kuriami kiti įrašai (pvz. įsigyto gyvūno gimimas) nėra
    // laikytojo įvykiai. `ctx.caller` klientas per API nustatyti negali.
    if (LATENESS_SET_BY_CALLER.includes(ctx.caller)) {
      ctx.params.isLate = ctx.params.isLate === true;
      ctx.params.lateReason = ctx.params.isLate ? ctx.params.lateReason : null;
    } else {
      Object.assign(
        ctx.params,
        resolveLateness(this.requireEventDate(ctx.params), ctx.params.lateReason),
      );
    }

    ctx.params.tenant = ctx.meta.profile;
    ctx.params.user = ctx.meta.user.id;

    return ctx;
  }
  @Action({
    rest: <RestSchema>{
      method: 'POST',
      path: '/upload',
      type: 'multipart',
      busboyConfig: {
        limits: {
          files: 1,
        },
      },
    },
  })
  async upload(ctx: Context<{}>) {
    return ctx.call('minio.uploadFile', {
      payload: ctx.params,
      folder: 'records',
    });
  }

  @Method
  async afterCreate(ctx: Context<any, UserAuthMeta>, data: Record) {
    if (data.species) {
      const species: Species<'speciesClassifier' | 'permit'> = await ctx.call('species.get', {
        id: data?.species,
        populate: ['speciesClassifier', 'permit'],
      });
      if (
        species?.speciesClassifier?.type &&
        [
          RecordType.ACQUIREMENT,
          RecordType.DEATH,
          RecordType.BIRTH,
          RecordType.SALE,
          RecordType.OBTAINMENT_OF_FOSTERED_ANIMAL,
          RecordType.PICK_UP_FROM_NATURE,
        ].some((record) => record === data.type)
      ) {
        await ctx.call('mail.sendRecordEmail', { record: data, species });
      }
    }
    return data;
  }

  // Grupinėje apskaitoje kiekį keičiantis įrašas privalo turėti kiekį ir negali nuvesti
  // likučio į minusą. Individualioje apskaitoje kiekis seka iš pačių gyvūnų.
  @Method
  validateNumberOfAnimals(species: Species, type: RecordType, numberOfAnimals?: number) {
    const isGroup = species.type !== AccountingType.INDIVIDUAL;
    if (!isGroup || !AMOUNT_RECORD_TYPES.includes(type)) return;

    const count = numberOfAnimals ?? 0;
    const exceedsStock = OUTGOING_RECORD_TYPES.includes(type) && (species.amount ?? 0) - count < 0;
    if (count < 1 || exceedsStock) {
      throwInvalidNumberOfAnimals();
    }
  }

  // Keičiant grupinės apskaitos įrašą likutis negali tapti neigiamas — kitaip administratorius,
  // padidinęs nugaišusių ar sumažinęs įsigytų skaičių arba perkėlęs įrašą kitai rūšiai, galėjo
  // nuvesti likutį į minusą. Tikrinama tik pasikeitus kiekiui, tipui ar rūšiai, kad seni
  // įrašai liktų redaguojami kitais laukais.
  @Method
  async validateChangedNumberOfAnimals(ctx: Context<any, UserAuthMeta>) {
    const previous: Record = ctx.locals.entity;
    // Perduotas `null` irgi yra pakeitimas, todėl tikrinama `undefined`, ne `??`.
    const paramOrPrevious = <K extends 'species' | 'type' | 'numberOfAnimals'>(
      field: K,
    ): Record[K] => (ctx.params[field] !== undefined ? ctx.params[field] : previous[field]);
    const numberOfAnimals = paramOrPrevious('numberOfAnimals');
    const next = {
      species: paramOrPrevious('species'),
      type: paramOrPrevious('type'),
      numberOfAnimals: numberOfAnimals == null ? numberOfAnimals : Number(numberOfAnimals),
    };
    const isChanged =
      Number(next.species) !== Number(previous.species) ||
      next.type !== previous.type ||
      next.numberOfAnimals !== previous.numberOfAnimals;

    if (isChanged) await this.assertStockAfterChange(ctx, previous, next);
    return ctx;
  }

  // Ištrynus įsigijimo ar gimimo įrašą, kai dalis gyvūnų jau išėjo, likutis taip pat taptų
  // neigiamas.
  @Method
  async validateRemovedNumberOfAnimals(ctx: Context<any, UserAuthMeta>) {
    await this.assertStockAfterChange(ctx, ctx.locals.entity);
    return ctx;
  }

  // Grupinės apskaitos rūšies likutis po pakeitimo negali sumažėti žemiau nulio. Tikrinamas tik
  // mažėjimas, kad jau neigiami seni duomenys netrukdytų jų taisyti.
  @Method
  async assertStockAfterChange(
    ctx: Context<any, UserAuthMeta>,
    previous: Partial<Record>,
    next?: Pick<Record, 'species' | 'type' | 'numberOfAnimals'>,
  ) {
    const amountChanges = new Map<number, number>();
    const addChange = (speciesId: number | undefined | null, change: number) => {
      if (!speciesId) return;
      const id = Number(speciesId);
      amountChanges.set(id, (amountChanges.get(id) ?? 0) + change);
    };
    addChange(previous.species, -calculateGroupAmount([previous as Record]));
    if (next) addChange(next.species, calculateGroupAmount([next]));

    for (const [speciesId, change] of amountChanges) {
      const species: Species = await ctx.call('species.resolve', { id: speciesId });
      if (!species || species.type === AccountingType.INDIVIDUAL) continue;

      const isAmountRecord =
        !!next && speciesId === Number(next.species) && AMOUNT_RECORD_TYPES.includes(next.type);
      if (
        (isAmountRecord && (next.numberOfAnimals ?? 0) < 1) ||
        (change < 0 && (species.amount ?? 0) + change < 0)
      ) {
        throwInvalidNumberOfAnimals();
      }
    }
  }

  // Perskaičiuojama ir ankstesnė (`beforeMutate` įsiminta), ir dabartinė įrašo rūšis —
  // administratoriui perkėlus įrašą kitai rūšiai, abi turi teisingą kiekį.
  // `remove` grąžina tik id, todėl pašalintas įrašas imamas iš `ctx.locals.entity`.
  @Method
  async recalculateSpeciesAmount(ctx: Context<unknown, UserAuthMeta>, result: Record | number) {
    const previous: Partial<Record> | undefined = ctx.locals.entity;
    const current: Partial<Record> | undefined = typeof result === 'object' ? result : previous;
    const speciesIds = new Set(
      [
        await this.resolveSpeciesIdForRecord(ctx, previous),
        await this.resolveSpeciesIdForRecord(ctx, current),
      ].filter((id): id is number => !!id),
    );
    for (const id of speciesIds) {
      await ctx.call('species.recalculateAmount', { id });
    }
    return result;
  }

  // Gyvūno įrašai `species` lauko dažnai neturi — rūšis imama iš paties gyvūno.
  @Method
  async resolveSpeciesIdForRecord(
    ctx: Context<unknown, UserAuthMeta>,
    record?: Partial<Record>,
  ): Promise<number | undefined> {
    if (!record) return undefined;
    if (record.species) return record.species;
    if (!record.animal) return undefined;

    const animal: Pick<Animal, 'species'> | null = await ctx.call('animals.resolve', {
      id: record.animal,
      fields: ['species'],
    });

    return animal?.species;
  }

  // AAD sprendimas (#85, 11 kl.): gyvūno ir globojamo gyvūno kortelėje rodomas naujausio
  // „Sertifikato Nr.“ įrašo numeris. Skaičiuojama iš visų likusių įrašų, todėl atgaline data
  // įvestas, pakeistas ar ištrintas įrašas palieka teisingą numerį; nelikus įrašų kortelės
  // reikšmė nekeičiama. Rūšies (grupinės apskaitos) kortelė nesinchronizuojama.
  @Method
  async syncCurrentCertificate(ctx: Context<unknown, UserAuthMeta>, result: Record | number) {
    const previous: Partial<Record> | undefined = ctx.locals.entity;
    const current: Partial<Record> | undefined = typeof result === 'object' ? result : undefined;
    const certificateRecords = [previous, current].filter(
      (record) => record?.type === RecordType.CERTIFICATE_NO,
    );

    const animalIds = new Set(certificateRecords.map(({ animal }) => animal).filter(Boolean));
    const fosteredIds = new Set(
      certificateRecords.map(({ fosteredAnimal }) => fosteredAnimal).filter(Boolean),
    );

    for (const id of animalIds) {
      await this.applyLatestCertificate(ctx, 'animals', id);
    }
    for (const id of fosteredIds) {
      await this.applyLatestCertificate(ctx, 'fosteredAnimals', id);
    }

    return result;
  }

  // Įrašai imami be naudotojo filtro: numerį galėjo įvesti kitas to paties leidimo naudotojas.
  @Method
  async applyLatestCertificate(ctx: Context, service: 'animals' | 'fosteredAnimals', id: number) {
    const owner = service === 'animals' ? { animal: id } : { fosteredAnimal: id };
    const records: Record[] = await this.broker.call('records.find', {
      query: { ...owner, type: RecordType.CERTIFICATE_NO },
    });
    const certificate = latestRecordByDate(records)?.certificateNo;
    if (!certificate) return;

    await ctx.call(`${service}.setCurrentCertificate`, {
      id,
      certificate,
    });
  }

  @Method
  async handleFilters(ctx: Context<any, UserAuthMeta>) {
    if (ctx.params.species) {
      ctx.params.species = Number(ctx.params.species);
    }
    if (ctx.params.animal) {
      ctx.params.animal = Number(ctx.params.animal);
    }
  }
}
