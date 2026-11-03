import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { expect, it } from 'vitest';
import { createIndexerHealthRoutes } from './routes.js';
import { workerExecutionStatus } from '../../../shared/queue/worker-execution.js';

it('reports indexer unavailable even when the lag snapshot would otherwise be healthy', async () => {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  try {
    await app.register(
      createIndexerHealthRoutes({
        network: 'testnet',
        trackedContracts: [],
        lagAlertThreshold: 100,
        getIndexerHealth: async () => ({
          latestLedger: 123,
          healthy: true,
          contracts: [
            {
              contractName: 'escrow',
              configured: true,
              lastLedgerSeq: '123',
              lagLedgers: 0,
              healthy: true,
            },
          ],
        }),
      }),
    );
    const response = await app.inject({ url: '/health/indexer' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'degraded',
      latestLedger: 123,
      workerExecution: workerExecutionStatus,
      contracts: [
        {
          contractName: 'escrow',
          configured: true,
          lastLedgerSeq: '123',
          lagLedgers: 0,
          healthy: false,
        },
      ],
    });
  } finally {
    await app.close();
  }
});
