import { z } from 'zod';

/**
 * Every environment variable the application reads, validated once at boot.
 * Failing fast here (instead of discovering a missing var mid-request) is
 * the whole point — see docs/DEPLOYMENT.md.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  STELLAR_NETWORK: z.enum(['testnet', 'futurenet', 'mainnet', 'standalone']).default('testnet'),
  SOROBAN_RPC_URL: z.string().url().default('https://soroban-testnet.stellar.org'),
  STELLAR_NETWORK_PASSPHRASE: z.string().default('Test SDF Network ; September 2015'),

  ESCROW_CONTRACT_ID: z.string().optional(),
  DELIVERY_CONTRACT_ID: z.string().optional(),
  DISPUTE_RESOLUTION_CONTRACT_ID: z.string().optional(),
  FLEET_MANAGEMENT_CONTRACT_ID: z.string().optional(),
  IDENTITY_REPUTATION_CONTRACT_ID: z.string().optional(),
  SETTLEMENT_CONTRACT_ID: z.string().optional(),

  INDEXER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  INDEXER_LAG_ALERT_LEDGERS: z.coerce.number().int().positive().default(50),

  /** Local-filesystem root for dispute evidence files — see
   * src/modules/disputes/infrastructure/local-evidence-storage.ts. */
  EVIDENCE_STORAGE_DIR: z.string().default('./storage/evidence'),

  /** Maximum size in bytes for evidence file uploads. Base64-encoded payloads
   * are ~33% larger than the decoded file, so the actual file limit is
   * approximately EVIDENCE_MAX_BYTES * 0.75. */
  EVIDENCE_MAX_BYTES: z.coerce.number().int().positive().default(10_485_760),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
