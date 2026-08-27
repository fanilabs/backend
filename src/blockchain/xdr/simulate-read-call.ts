import {
  Account,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  rpc,
} from '@stellar/stellar-sdk';
import type { xdr } from '@stellar/stellar-sdk';
import { getConfig } from '../../shared/config/index.js';
import { BlockchainError } from '../../shared/errors/index.js';
import type { SorobanClient } from '../soroban-client.js';
import { scValToNative } from './sc-val.js';

export interface SimulateReadCallInput {
  contractId: string;
  method: string;
  args: xdr.ScVal[];
}

/**
 * Runs a read-only contract query (e.g. `get_delivery`) via simulation and
 * returns the decoded return value — no signing, no submission, and no
 * real account required. Uses a fresh throwaway keypair as the simulation's
 * nominal source account; verified empirically against the real testnet
 * RPC that an unfunded, non-existent-on-ledger account works fine for
 * simulating a view call (see soroban-client.ts's `simulateTransaction`).
 */
export async function simulateReadCall(
  client: SorobanClient,
  input: SimulateReadCallInput,
): Promise<unknown> {
  const config = getConfig();
  const dummyAccount = new Account(Keypair.random().publicKey(), '0');
  const contract = new Contract(input.contractId);

  const tx = new TransactionBuilder(dummyAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(input.method, ...input.args))
    .setTimeout(30)
    .build();

  const sim = await client.simulateTransaction(tx);

  if (!rpc.Api.isSimulationSuccess(sim)) {
    throw new BlockchainError(`Simulation failed for ${input.method}`, {
      method: input.method,
      contractId: input.contractId,
      error: 'error' in sim ? sim.error : 'unknown simulation failure',
    });
  }
  if (!sim.result) {
    throw new BlockchainError(`Simulation for ${input.method} returned no result`, {
      method: input.method,
      contractId: input.contractId,
    });
  }

  return scValToNative(sim.result.retval);
}
