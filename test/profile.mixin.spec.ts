'use strict';

import ProfileMixin from '../mixins/profile.mixin';
import { AuthUserRole } from '../services/api.service';

const FIELDS = [
  { name: 'id' },
  { name: 'permitNumber' },
  { name: 'createdAt' },
  { name: 'municipality' },
  { name: 'speciesClassifier' },
  { name: 'markingRecord', virtual: true },
];

const SPECIES_CLASSIFIER_FIELDS = [{ name: 'id' }, { name: 'name' }, { name: 'nameLatin' }];

const createService = () => ({
  ...ProfileMixin.methods,
  $fields: FIELDS,
  settings: {
    fields: {
      municipality: 'any',
      speciesClassifier: { deepQuery: 'speciesClassifiers' },
    },
  },
  broker: {
    getLocalService: (name: string) =>
      name === 'speciesClassifiers' ? { $fields: SPECIES_CLASSIFIER_FIELDS } : undefined,
  },
});

const createCtx = (params: any = {}, meta: any = { authUser: { type: AuthUserRole.ADMIN } }) => ({
  params,
  meta,
});

describe('profile.mixin beforeSelect sort handling', () => {
  it('keeps the sort requested by the client', () => {
    const service = createService();
    const ctx = service.beforeSelect(createCtx({ sort: ['-permitNumber'] }) as any);

    expect(ctx.params.sort).toEqual(['-permitNumber']);
  });

  it('applies the default sort when the client sends none', () => {
    const service = createService();
    const ctx = service.beforeSelect(createCtx() as any);

    expect(ctx.params.sort).toEqual('-createdAt');
  });

  it('keeps client sort for non-admin users as well', () => {
    const service = createService();
    const ctx = service.beforeSelect(
      createCtx(
        { sort: 'permitNumber' },
        { authUser: { type: AuthUserRole.USER }, user: { id: 5 } },
      ) as any,
    );

    expect(ctx.params.sort).toEqual(['permitNumber']);
    expect(ctx.params.query).toEqual({ user: 5 });
  });

  it('drops sort keys that are not real table columns', () => {
    const service = createService();
    const ctx = service.beforeSelect(
      createCtx({ sort: ['-user.firstName', 'permitNumber'] }) as any,
    );

    expect(ctx.params.sort).toEqual(['permitNumber']);
  });

  it('drops sort keys pointing to virtual fields', () => {
    const service = createService();
    const ctx = service.beforeSelect(createCtx({ sort: ['markingRecord'] }) as any);

    expect(ctx.params.sort).toEqual('-createdAt');
  });

  it('falls back to the default sort when no requested key is sortable', () => {
    const service = createService();
    const ctx = service.beforeSelect(createCtx({ sort: ['municipality.name'] }) as any);

    expect(ctx.params.sort).toEqual('-createdAt');
  });

  it('keeps dotted sort keys backed by a deepQuery relation', () => {
    const service = createService();
    const ctx = service.beforeSelect(createCtx({ sort: ['-speciesClassifier.name'] }) as any);

    expect(ctx.params.sort).toEqual(['-speciesClassifier.name']);
  });

  it('drops dotted sort keys whose column does not exist on the related service', () => {
    const service = createService();
    const ctx = service.beforeSelect(createCtx({ sort: ['speciesClassifier.bogus'] }) as any);

    expect(ctx.params.sort).toEqual('-createdAt');
  });

  it('drops dotted sort keys deeper than one relation level', () => {
    const service = createService();
    const ctx = service.beforeSelect(createCtx({ sort: ['speciesClassifier.family.name'] }) as any);

    expect(ctx.params.sort).toEqual('-createdAt');
  });
});

describe('profile.mixin beforeMutate ownership', () => {
  const entity = { id: 7, tenant: 3, user: 5, species: 11 };

  const mutateService = () => ({
    ...createService(),
    resolveEntities: jest.fn().mockResolvedValue(entity),
  });

  const createMutateCtx = (params: any, meta: any) => ({ params, meta, locals: {} });

  it('admin resolves the entity without an access filter and keeps ownership params', async () => {
    const service = mutateService();
    const ctx = await service.beforeMutate(
      createMutateCtx({ id: 7, tenant: 9 }, { authUser: { type: AuthUserRole.ADMIN } }) as any,
    );

    expect(service.resolveEntities).toHaveBeenCalledWith(
      expect.anything(),
      { id: 7, query: {} },
      { throwIfNotExist: true },
    );
    expect(ctx.params.tenant).toBe(9);
    expect(ctx.locals.entity).toEqual(entity);
  });

  it('tenant profile user is restricted to the tenant and cannot reassign ownership', async () => {
    const service = mutateService();
    const ctx = await service.beforeMutate(
      createMutateCtx(
        { id: 7, tenant: 9, user: 1 },
        { authUser: { type: AuthUserRole.USER }, user: { id: 5 }, profile: 3 },
      ) as any,
    );

    expect(service.resolveEntities).toHaveBeenCalledWith(
      expect.anything(),
      { id: 7, query: { tenant: 3 } },
      { throwIfNotExist: true },
    );
    expect(ctx.params.tenant).toBe(3);
    expect(ctx.params.user).toBe(5);
  });

  it('profile-less user is restricted to own rows', async () => {
    const service = mutateService();
    await service.beforeMutate(
      createMutateCtx({ id: 7 }, { authUser: { type: AuthUserRole.USER }, user: { id: 5 } }) as any,
    );

    expect(service.resolveEntities).toHaveBeenCalledWith(
      expect.anything(),
      { id: 7, query: { user: 5 } },
      { throwIfNotExist: true },
    );
  });

  it('drops an ownership param when the entity has no owner value to keep', async () => {
    const service = mutateService();
    service.resolveEntities.mockResolvedValue({ id: 7, tenant: null, user: 5 });
    const ctx = await service.beforeMutate(
      createMutateCtx(
        { id: 7, tenant: 9 },
        { authUser: { type: AuthUserRole.USER }, user: { id: 5 } },
      ) as any,
    );

    expect(ctx.params).toEqual({ id: 7 });
  });

  it('propagates the not-found error for a foreign entity', async () => {
    const service = mutateService();
    service.resolveEntities.mockRejectedValue(new Error('EntityNotFound'));

    await expect(
      service.beforeMutate(
        createMutateCtx(
          { id: 7 },
          { authUser: { type: AuthUserRole.USER }, user: { id: 5 } },
        ) as any,
      ),
    ).rejects.toThrow('EntityNotFound');
  });
});
