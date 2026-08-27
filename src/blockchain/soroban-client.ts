import { rpc } from '@stellar/stellar-sdk';
import type { Account, Transaction, FeeBumpTransaction } from '@stellar/stellar-sdk';
import { getConfig } from '../shared/config/index.js';
import { logger } from '../shared/logger/index.js';
import { BlockchainError } from '../shared/errors/index.js';
import { withRetry, CircuitBreaker } from './retry.js';

const log = logger.child({ module: 'soroban-client' });

/**
 * The one resilient entry point to Soroban RPC (ARCHITECTURE.md §4, adopted
 * from PHASE_2_REFERENCE_ANALYSIS.md §5.4). Per-contract typed clients
 * (src/blockchain/contracts/*) and unsigned-transaction builders
 * (src/blockchain/xdr/*) are built on top of this in Phase 5 — nothing
 * should construct its own `rpc.Server` instance.
 */
export class SorobanClient {
  private readonly server: rpc.Server;
  private readonly breaker: CircuitBreaker;

  constructor(rpcUrl: string = getConfig().SOROBAN_RPC_URL) {
    this.server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });
    this.breaker = new CircuitBreaker();
  }

  /** Raw server escape hatch for contract-client builders that need the full API surface. */
  get raw(): rpc.Server {
    return this.server;
  }

  async getHealth(): Promise<rpc.Api.GetHealthResponse> {
    return this.call(() => this.server.getHealth(), 'getHealth');
  }

  async getLatestLedger(): Promise<rpc.Api.GetLatestLedgerResponse> {
    return this.call(() => this.server.getLatestLedger(), 'getLatestLedger');
  }

  async getEvents(request: rpc.Server.GetEventsRequest): Promise<rpc.Api.GetEventsResponse> {
    return this.call(() => this.server.getEvents(request), 'getEvents');
  }

  /** Current sequence number + account state, needed as the source account
   * for every unsigned transaction this backend builds. */
  async getAccount(publicKey: string): Promise<Account> {
    return this.call(() => this.server.getAccount(publicKey), 'getAccount');
  }

  /** Simulates a contract-invocation transaction and returns it fully
   * assembled (resource fees, footprint, and auth entries populated) —
   * required before a Soroban transaction can be submitted. Not retried on
   * simulation/contract-level failures (e.g. an `Unauthorized` panic) since
   * `isRetryableRpcError` only matches network-level error messages, and
   * retrying a genuine simulation failure would just repeat it. */
  async prepareTransaction(tx: Transaction | FeeBumpTransaction) {
    return this.call(() => this.server.prepareTransaction(tx), 'prepareTransaction');
  }

  /** Simulates without assembling a submittable transaction — for read-only
   * contract queries (e.g. `get_delivery`), where only `result.retval`
   * matters and there's nothing to sign/submit. Verified empirically
   * against the real testnet RPC and a real deployed contract that
   * simulation succeeds with a fresh, unfunded source account — Soroban
   * read-only simulation doesn't require the source account to actually
   * exist on-ledger. */
  async simulateTransaction(
    tx: Transaction | FeeBumpTransaction,
  ): Promise<rpc.Api.SimulateTransactionResponse> {
    return this.call(() => this.server.simulateTransaction(tx), 'simulateTransaction');
  }

  private async call<T>(fn: () => Promise<T>, operation: string): Promise<T> {
    try {
      return await this.breaker.execute(() => withRetry(fn, { isRetryable: isRetryableRpcError }));
    } catch (error) {
      log.error({ err: error, operation }, 'Soroban RPC call failed');
      throw new BlockchainError(`Soroban RPC call failed: ${operation}`, {
        operation,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Network-level failures (timeouts, connection resets, 5xx) are retried;
 * anything that looks like a well-formed RPC error response is treated as
 * non-retryable, since retrying a malformed request just repeats the same
 * failure.
 */
function isRetryableRpcError(error: unknown): boolean {
  if (error instanceof Error) {
    return /timeout|ECONNRESET|ECONNREFUSED|network|fetch failed|502|503|504/i.test(error.message);
  }
  return false;
}

let defaultClient: SorobanClient | undefined;

export function getSorobanClient(): SorobanClient {
  defaultClient ??= new SorobanClient();
  return defaultClient;
}
