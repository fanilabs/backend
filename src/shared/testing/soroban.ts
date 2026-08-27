import { SorobanClient } from '../../blockchain/soroban-client.js';

/**
 * Gates tests that hit a real, public Soroban RPC endpoint (there are no
 * FaniLab contracts deployed to test against in this repository's own CI,
 * but the public testnet RPC itself is reachable and worth exercising the
 * resilient client against — see PHASE_1/ARCHITECTURE for why FaniLab
 * contract deployment is out of this backend's control). Same
 * skip-not-fail pattern as isDatabaseAvailable.
 */
export async function isSorobanRpcAvailable(rpcUrl?: string): Promise<boolean> {
  try {
    const client = new SorobanClient(rpcUrl);
    const health = await client.getHealth();
    return health.status === 'healthy';
  } catch {
    return false;
  }
}
