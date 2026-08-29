import { z } from 'zod';

/**
 * Every environment variable the application reads, validated once at boot.
 * Failing fast here (instead of discovering a missing var mid-request) is
 * the whole point — see docs/DEPLOYMENT.md.
 */
const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // No `.default()` here: whether an unset LOG_LEVEL means 'info' or 'silent'
  // depends on NODE_ENV (see the `.transform` below, which is the single
  // place that decides it) — see src/shared/logger/index.ts.
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),

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

  // `SETTLEMENT_CONTRACT_ID` deliberately does not exist here: settlement is
  // an unimplemented on-chain stub with no consuming module (see the same
  // exclusion in src/modules/indexer/index.ts and ROADMAP.md §9) — a config
  // variable with no reader is documentation debt CONTRIBUTING.md prohibits.
  // Re-add it when settlement_contract is actually implemented.
  ESCROW_CONTRACT_ID: z.string().optional(),
  DELIVERY_CONTRACT_ID: z.string().optional(),
  DISPUTE_RESOLUTION_CONTRACT_ID: z.string().optional(),
  FLEET_MANAGEMENT_CONTRACT_ID: z.string().optional(),
  IDENTITY_REPUTATION_CONTRACT_ID: z.string().optional(),

  INDEXER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  INDEXER_LAG_ALERT_LEDGERS: z.coerce.number().int().positive().default(50),

  /** Local-filesystem root for dispute evidence files — see
   * src/modules/disputes/infrastructure/local-evidence-storage.ts. The
   * relative default resolves against the process working directory and is
   * a development-only convenience; a deployed environment must set this to
   * an absolute path backed by persistent storage (docker-compose.yml's
   * `evidence-data` volume mounts it at /var/lib/fanilab/evidence) or every
   * uploaded file is lost on container recreation. See docs/DEPLOYMENT.md
   * § Evidence Storage. */
  EVIDENCE_STORAGE_DIR: z.string().default('./storage/evidence'),

  /** Maximum size in bytes for evidence file uploads. Base64-encoded payloads
   * are ~33% larger than the decoded file, so the actual file limit is
   * approximately EVIDENCE_MAX_BYTES * 0.75. */
  EVIDENCE_MAX_BYTES: z.coerce.number().int().positive().default(10_485_760),
});

/**
 * `LOG_LEVEL`'s effective default depends on `NODE_ENV`: tests should be
 * quiet unless a level is explicitly requested, everything else defaults to
 * `info`. Expressing that here — the single source of truth for config —
 * means src/shared/logger/index.ts can trust `getConfig().LOG_LEVEL` as-is
 * instead of re-reading `process.env` itself and bypassing validation.
 */
const envSchema = baseEnvSchema.transform((env) => ({
  ...env,
  LOG_LEVEL: env.LOG_LEVEL ?? (env.NODE_ENV === 'test' ? ('silent' as const) : ('info' as const)),
}));

export type Env = z.infer<typeof envSchema>;

/** Exposed only for the .env.example drift test — see env.test.ts. */
export const envSchemaKeys = Object.keys(baseEnvSchema.shape);

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
