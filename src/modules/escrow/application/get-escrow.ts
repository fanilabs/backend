import type { Escrow, EscrowRepository } from '../domain/index.js';
import { EscrowNotFoundError } from '../domain/index.js';

export interface GetEscrowDeps {
  escrowRepository: EscrowRepository;
}

export interface GetEscrowInput {
  chainDeliveryId: bigint;
}

export function createGetEscrowUseCase(deps: GetEscrowDeps) {
  return async function getEscrow(input: GetEscrowInput): Promise<Escrow> {
    const escrow = await deps.escrowRepository.findByChainDeliveryId(input.chainDeliveryId);
    if (!escrow) {
      throw new EscrowNotFoundError();
    }
    return escrow;
  };
}
