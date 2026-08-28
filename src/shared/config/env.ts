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
   * src/modules/disputes/infrastructure/local-evidence-storage.ts. The
   * relative default resolves against the process working directory and is
   * a development-only convenience; a deployed environment must set this to
   * an absolute path backed by persistent storage (docker-compose.yml's
   * `evidence-data` volume mounts it at /var/lib/fanilab/evidence) or every
   * uploaded file is lost on container recreation. See docs/DEPLOYMENT.md
   * § Evidence Storage. */
  EVIDENCE_STORAGE_DIR: z.string().default('./storage/evidence'),

  /** Selects the Mailer/NotificationSender adapter each composition root
   * wires up (src/modules/auth/index.ts, src/modules/notifications/index.ts).
   * `logger` is the development/test default — it logs instead of sending
   * real mail and is deliberately refused when NODE_ENV=production (see
   * select-mailer.ts / select-notification-sender.ts): a production
   * deployment with no real provider configured should fail loudly at boot,
   * not silently send no mail. No real provider is wired up yet — set this
   * once one exists. */
  MAIL_PROVIDER: z.enum(['logger']).default('logger'),
  NOTIFICATION_PROVIDER: z.enum(['logger']).default('logger'),
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
