import * as Joi from 'joi';

/**
 * Environment variable validation schema.
 *
 * All required variables are validated at application startup via
 * ConfigModule.forRoot({ validationSchema }).  If any required
 * variable is missing or malformed, the application will fail to
 * boot with a clear error message.
 *
 * Variables marked as optional have sensible defaults in the codebase
 * or are only needed for specific features (indexer, oracle, etc.).
 */

export const validationSchema = Joi.object({
  // ── Node environment ────────────────────────────────────────────────────
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  PORT: Joi.number().port().default(3001),

  // ── Database (PostgreSQL) ───────────────────────────────────────────────
  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().port().default(5432),
  DB_USERNAME: Joi.string().default('postgres'),
  DB_PASSWORD: Joi.string()
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string().required().messages({
        'any.required': 'DB_PASSWORD is required in production',
      }),
      otherwise: Joi.string().default('postgres'),
    }),
  DB_DATABASE: Joi.string().default('back_it_onchain'),
  // Aliases used by data-source.ts (TypeORM CLI)
  DB_NAME: Joi.string().optional(),

  // ── Authentication (JWT) ────────────────────────────────────────────────
  JWT_SECRET: Joi.string()
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string().min(32).required().messages({
        'any.required': 'JWT_SECRET is required in production',
        'string.min': 'JWT_SECRET must be at least 32 characters in production',
      }),
      otherwise: Joi.string().default('dev-secret'),
    }),

  // ── Oracle — EVM (Base) ────────────────────────────────────────────────
  ORACLE_PRIVATE_KEY: Joi.string()
    .pattern(/^0x[0-9a-fA-F]{64}$/)
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string().required().messages({
        'any.required':
          'ORACLE_PRIVATE_KEY is required in production (64-char hex prefixed with 0x)',
        'string.pattern.base':
          'ORACLE_PRIVATE_KEY must be a 64-character hex string prefixed with 0x',
      }),
      otherwise: Joi.string().optional(),
    }),
  OUTCOME_MANAGER_ADDRESS: Joi.string()
    .pattern(/^0x[0-9a-fA-F]{40}$/)
    .optional()
    .messages({
      'string.pattern.base':
        'OUTCOME_MANAGER_ADDRESS must be a valid EVM address (0x + 40 hex chars)',
    }),

  // ── Oracle — Stellar ───────────────────────────────────────────────────
  STELLAR_ORACLE_SECRET_KEY: Joi.string()
    .pattern(/^S[A-Z2-7]{55}$/)
    .optional()
    .messages({
      'string.pattern.base':
        'STELLAR_ORACLE_SECRET_KEY must be a valid Stellar secret key (S + 55 alphanumeric chars)',
    }),

  // ── Indexer (Base Sepolia) ──────────────────────────────────────────────
  BASE_SEPOLIA_RPC_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .optional(),
  CALL_REGISTRY_ADDRESS: Joi.string()
    .pattern(/^0x[0-9a-fA-F]{40}$/)
    .optional()
    .messages({
      'string.pattern.base':
        'CALL_REGISTRY_ADDRESS must be a valid EVM address (0x + 40 hex chars)',
    }),

  // ── IPFS ───────────────────────────────────────────────────────────────
  IPFS_API_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .default('http://localhost:5001'),
  PINATA_JWT: Joi.string().optional(),

  // ── Admin ──────────────────────────────────────────────────────────────
  ADMIN_API_KEY: Joi.string().optional(),

  // ── Redis (optional — falls back to in-memory cache) ────────────────────
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .optional(),

  // ── CORS ───────────────────────────────────────────────────────────────
  CORS_ORIGINS: Joi.string().optional(),
  CORS_ORIGIN: Joi.string().optional(),

  // ── Notifications ──────────────────────────────────────────────────────
  NOTIFICATION_RETENTION_DAYS: Joi.number().min(1).default(30),

  // ── Discord (optional — admin alerts for abandoned calls) ──────────────
  DISCORD_ADMIN_WEBHOOK_URL: Joi.string()
    .uri({ scheme: ['https'] })
    .optional(),
});
