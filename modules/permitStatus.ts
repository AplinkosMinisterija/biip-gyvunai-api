import { Errors } from 'moleculer';

// AAD sprendimai (#85, 5 ir 35 kl.): panaikinus leidimą jo gyvūnai lieka, kol turėtojas juos
// perleidžia, paleidžia ar praneša apie gaišimą. Toks leidimas turėtojui lieka matomas su statusu
// „Leidimas panaikintas (reikalingas perleidimas / iškėlimas)“. Statusas taikomas tik leidimams,
// panaikintiems po šio pakeitimo įdiegimo; anksčiau panaikinti lieka tiesiog panaikinti.
export enum PermitStatus {
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
  RELOCATION_REQUIRED = 'RELOCATION_REQUIRED',
}

type PermitRow = { deletedAt?: Date | string | null; relocationRequired?: boolean | null };

export const permitStatus = (permit: PermitRow): PermitStatus => {
  if (!permit.deletedAt) return PermitStatus.ACTIVE;

  return permit.relocationRequired ? PermitStatus.RELOCATION_REQUIRED : PermitStatus.REVOKED;
};

// Rūšis be leidimo (pvz. globojami gyvūnai) neribojama. Leidimas turi būti gautas su laukeliu
// `status` (pvz. per `permits.resolve` su `scope: false`).
export const isPermitRevoked = (permit?: { status?: PermitStatus } | null): boolean =>
  !!permit?.status && permit.status !== PermitStatus.ACTIVE;

export const throwPermitRevokedError = (): never => {
  throw new Errors.MoleculerClientError('Permit is revoked', 422, 'PERMIT_REVOKED');
};
