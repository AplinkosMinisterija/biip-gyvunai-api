'use strict';

import Moleculer, { Context } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';
import { parseQuery } from '../modules/clientQuery';
import { AuthUserRole, UserAuthMeta } from './api.service';

@Service({
  name: 'statistics',
})
export default class StatisticsService extends Moleculer.Service {
  @Action({
    rest: 'GET /',
  })
  async getStatistics(ctx: Context<any, UserAuthMeta>) {
    const isAdmin = [AuthUserRole.ADMIN, AuthUserRole.SUPER_ADMIN].some(
      (r) => r === ctx.meta.authUser.type,
    );
    const params = ctx.params.filter ? JSON.parse(ctx.params.filter) : {};
    let filters: any = { ...params };
    if (!isAdmin) {
      if (ctx.meta.profile) {
        filters.tenant = ctx.meta.profile;
      } else {
        filters.user = ctx.meta.user.id;
      }
    }
    const data: any = {};
    // `query` gali ateiti ir kaip JSON eilutė; lytį nustato pats veiksmas.
    const query = parseQuery(ctx.params?.query);

    data.male = await ctx.call('animals.count', {
      filter: {
        ...filters,
      },
      query: { ...query, gender: 'MALE' },
    });
    data.female = await ctx.call('animals.count', {
      filter: {
        ...filters,
      },
      query: { ...query, gender: 'FEMALE' },
    });
    if (!params.speciesClassifier && !params.species) {
      data.species = await ctx.call('species.count', {
        filter: {
          ...filters,
        },
      });
    }
    return data;
  }
}
