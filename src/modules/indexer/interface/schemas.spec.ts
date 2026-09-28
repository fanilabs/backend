import { describe, expect, it } from 'vitest';
import { indexerHealthResponseSchema } from './schemas.js';

describe('indexerHealthResponseSchema', () => {
  it('limits contract names to 255 characters', () => {
    const response = {
      status: 'ok',
      latestLedger: 1,
      contracts: [
        {
          contractName: 'c'.repeat(255),
          configured: true,
          lastLedgerSeq: '1',
          lagLedgers: 0,
          healthy: true,
        },
      ],
    };

    expect(indexerHealthResponseSchema.safeParse(response).success).toBe(true);
    expect(
      indexerHealthResponseSchema.safeParse({
        ...response,
        contracts: [{ ...response.contracts[0], contractName: 'c'.repeat(256) }],
      }).success,
    ).toBe(false);
  });
});
