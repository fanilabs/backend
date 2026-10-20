import { BASE_FEE, Contract, TransactionBuilder } from '@stellar/stellar-sdk';
import type { Memo, xdr } from '@stellar/stellar-sdk';
import { getConfig } from '../../shared/config/index.js';
import type { SorobanClient } from '../soroban-client.js';

export interface BuildInvokeTransactionInput {
  contractId: string;
  method: string;
  args: xdr.ScVal[];
  /** The account that will sign this transaction — becomes both the tx
   * source account (pays the fee, supplies the sequence number) and, for
   * every FaniLab contract call reviewed in PHASE_1_DOMAIN_ANALYSIS.md, the
   * `require_auth()`'d party. */
  sourceAddress: string;
  /** Optional fee cap in stroops. Defaults to BASE_FEE (100 stroops) when
   * omitted — useful during network congestion when base-fee transactions
   * would otherwise stall in validators' mempools. */
  fee?: string | number;
  /** Optional transaction memo (e.g. Memo.text('delivery-ref')) for
   * accounting correlation. No memo is attached when omitted. */
  memo?: Memo;
  /** Optional expiration timeout in seconds (defaults to 300s). */
  timeoutSeconds?: number;
}

export const DEFAULT_TX_TIMEOUT_SECONDS = 300;

/**
 * The one place every module's XDR builder goes through to turn a contract
 * call into an unsigned, ready-to-sign transaction — so fee/timeout/
 * simulation handling never drifts between modules (ARCHITECTURE.md §9:
 * this backend never signs on a user's behalf, it only builds).
 *
 * `prepareTransaction` simulates the call and fills in the resource fees,
 * footprint, and auth entries a Soroban transaction needs before it's
 * submittable — a bare `TransactionBuilder` result alone isn't enough.
 */
export async function buildInvokeTransaction(
  client: SorobanClient,
  input: BuildInvokeTransactionInput,
): Promise<string> {
  const config = getConfig();
  const account = await client.getAccount(input.sourceAddress);
  const contract = new Contract(input.contractId);

  let builder = new TransactionBuilder(account, {
    fee: String(input.fee ?? BASE_FEE),
    networkPassphrase: config.STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(input.method, ...input.args))
    .setTimeout(input.timeoutSeconds ?? DEFAULT_TX_TIMEOUT_SECONDS);

  if (input.memo) {
    builder = builder.addMemo(input.memo);
  }

  const transaction = builder.build();

  const prepared = await client.prepareTransaction(transaction);
  return prepared.toXDR();
}
