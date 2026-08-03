'use strict';

import ProfileMixin from '../mixins/profile.mixin';
import { AuthUserRole } from '../services/api.service';

const FIELDS = [
  { name: 'id' },
  { name: 'permitNumber' },
  { name: 'createdAt' },
  { name: 'municipality' },
  { name: 'markingRecord', virtual: true },
];

const createService = () => ({
  ...ProfileMixin.methods,
  $fields: FIELDS,
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
});
