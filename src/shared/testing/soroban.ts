import { SorobanClient } from '../../blockchain/soroban-client.js';

/**
 * Explicit opt-in flag for tests that contact a real, public Soroban RPC
 * endpoint. Without it, the public RPC probe is never invoked so normal
 * local development stays fully offline.
 */
export const SOROBAN_RPC_INTEGRATION_ENV = 'SOROBAN_RPC_INTEGRATION';

/**
 * Returns true only when the developer explicitly opted into public-RPC
 * integration checks via SOROBAN_RPC_INTEGRATION (e.g. "1" or "true").
 */
export function isSorobanRpcIntegrationEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env[SOROBAN_RPC_INTEGRATION_ENV];
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

/**
 * Gates tests that hit a real, public Soroban RPC endpoint (there are no
 * FaniLab contracts deployed to test against in this repository's own CI,
 * but the public testnet RPC itself is reachable and worth exercising the
 * resilient client against — see PHASE_1/ARCHITECTURE for why FaniLab
 * contract deployment is out of this backend's control). Same
 * skip-not-fail pattern as isDatabaseAvailable.
 *
 * The probe is only performed when the caller has explicitly opted in via
 * SOROBAN_RPC_INTEGRATION; otherwise it returns false without contacting the
 * network.
 */
export async function isSorobanRpcAvailable(rpcUrl?: string): Promise<boolean> {
  if (!isSorobanRpcIntegrationEnabled()) {
    return false;
  }
  try {
    const client = new SorobanClient(rpcUrl);
    const health = await client.getHealth();
    return health.status === 'healthy';
  } catch {
    return false;
  }
}
