'use strict';

import { map } from 'lodash';
import moleculer, { Context } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';
import { ServerClient } from 'postmark';
import { Record, RecordType } from './records.service';
import { PossesionType, Species } from './species.service';
import { SpeciesType } from './speciesClassifiers.service';

export function emailCanBeSent() {
  return ['production', 'staging'].includes(process.env.NODE_ENV);
}

const sender = 'noreply@biip.lt';

const actions: { [key: string]: string } = {
  [RecordType.SALE]: 'Parduotas/Padovanotas',
  [RecordType.BIRTH]: 'Gimė/išsirito',
  [RecordType.DEATH]: 'Nugaišo',
  [RecordType.ACQUIREMENT]: 'Įsigytas',
  [RecordType.PICK_UP_FROM_NATURE]: 'Paimtas iš gamtos',
  [RecordType.OBTAINMENT_OF_FOSTERED_ANIMAL]: 'Gautas globai',
};

const types = {
  [SpeciesType.PROTECTED]: 'saugomos',
  [SpeciesType.INVASIVE]: 'invazinės',
};

const client = new ServerClient(process.env.POSTMARK_KEY);

@Service({
  name: 'mail',
  mixins: [],
  settings: {},
})
export default class FishAgesService extends moleculer.Service {
  @Action({
    params: {
      record: 'object',
      species: 'object',
    },
  })
  async sendRecordEmail(
    ctx: Context<{
      record: Record;
      species: Species<'speciesClassifier' | 'permit'>;
    }>,
  ) {
    if (!emailCanBeSent()) return;

    const municipalityId =
      ctx.params.species.possessionType === PossesionType.WITH_PERMIT
        ? ctx.params.species.permit.municipality.id
        : ctx.params.species.municipality.id;
    const users: any = await ctx.call('auth.permissions.getUsersByAccess', {
      access: 'NLLG_EMAILS',
      data: {
        municipality: municipalityId,
      },
    });
    const emails: string[] = map(users.rows, (user) => user.email);
    const data = emails.map((email) => ({
      From: sender,
      To: email,
      TemplateId: 32744855,
      TemplateModel: {
        action: actions[ctx.params.record.type],
        type: types[ctx.params.species.speciesClassifier.type],
        speciesName: ctx.params.species.speciesClassifier.name,
        latinName: ctx.params.species.speciesClassifier.nameLatin,
        actionUrl: `${process.env.ADMIN_HOST}/nlg/gyvunu-zurnalas/${ctx.params.species.id}`,
      },
    }));
    try {
      return client.sendEmailBatchWithTemplates(data);
    } catch (err) {
      return false;
    }
  }
}
