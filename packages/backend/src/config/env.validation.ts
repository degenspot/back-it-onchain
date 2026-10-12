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
  DB_PASSWORD: Joi.string().when('NODE_ENV', {
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
  JWT_SECRET: Joi.string().when('NODE_ENV', {
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

  // ── Oracle — EIP-712 domain / KMS abstraction (BE-02) ───────────────────
  // Chain ID used in the EIP-712 domain. Defaults to Base mainnet (8453).
  ORACLE_CHAIN_ID: Joi.number().integer().positive().default(8453),
  // When set, the oracle signs through a remote KMS/Vault transit-style
  // endpoint instead of holding a raw private key in process memory.
  // Leave unset to fall back to ORACLE_PRIVATE_KEY (LocalWalletSigner).
  KMS_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .optional(),
  KMS_KEY_ID: Joi.string().when('KMS_URL', {
    is: Joi.exist(),
    then: Joi.string().required().messages({
      'any.required': 'KMS_KEY_ID is required when KMS_URL is set',
    }),
    otherwise: Joi.string().optional(),
  }),
  KMS_API_TOKEN: Joi.string().optional(),

  // ── Oracle — settlement (BE-01) ──────────────────────────────────────────
  // Fixed-point scale applied to USD prices before they are embedded in an
  // on-chain uint256 (e.g. "1000000000000000000" == 1e18). Kept as a string
  // since it is passed straight into BigInt().
  ORACLE_PRICE_SCALE: Joi.string()
    .pattern(/^[1-9][0-9]*$/)
    .default('1000000000000000000'),
  // Network slug used when querying GeckoTerminal's fallback price API.
  GECKOTERMINAL_NETWORK: Joi.string().default('base'),
  // Max number of due calls resolved per resolveDueCalls() sweep.
  ORACLE_RESOLUTION_BATCH_SIZE: Joi.number().integer().min(1).default(20),

  // ── Price staleness guard (BE-018) ───────────────────────────────────────
  // A quote older than this (in seconds) can no longer settle a call.
  ORACLE_MAX_PRICE_AGE_SECONDS: Joi.number()
    .integer()
    .min(1)
    .default(600),
  // A market trading under this much in 24 h can no longer settle a call: the
  // quoted price is real but not executable, and is easier to move.
  ORACLE_MIN_24H_VOLUME_USD: Joi.number().min(0).default(1000),

  // ── Disputes (BE-019) ────────────────────────────────────────────────────
  // Bond required to open or back a dispute. The spam guard: filing a dispute
  // has to cost something.
  DISPUTE_MIN_BOND: Joi.string().default('10'),
  // Aggregate stake that escalates a dispute to the governance multisig.
  DISPUTE_STAKE_THRESHOLD: Joi.string().default('100'),
  // Hours after settlement during which disputes may be lodged.
  DISPUTE_WINDOW_HOURS: Joi.number().integer().min(1).default(24),
  // Hours governance has to reach a decision once escalated.
  DISPUTE_VOTE_DURATION_HOURS: Joi.number().integer().min(1).default(48),
  // Approvals required to decide an escalated dispute.
  DISPUTE_GOVERNANCE_QUORUM: Joi.number().integer().min(1).default(3),
  // Comma-separated wallets that form the governance multisig. Empty means no
  // one can vote, so every dispute expires to CONFIRMED — the safe direction.
  GOVERNANCE_SIGNERS: Joi.string().allow('').default(''),

  // ── Ledger-aware scheduling (BE-020) ─────────────────────────────────────
  // Weight of the newest close sample in the velocity EMA. Higher reacts
  // faster to a change in network conditions; lower is steadier.
  LEDGER_VELOCITY_EMA_ALPHA: Joi.number().min(0.01).max(1).default(0.3),
  // Extra delay past the estimated close, covering the gap between a ledger
  // closing and the RPC reporting it closed.
  LEDGER_CLOSE_SETTLE_MS: Joi.number().integer().min(0).default(2000),
  // How often to sample ledger velocity.
  LEDGER_VELOCITY_SYNC_MS: Joi.number().integer().min(1000).default(15000),
  // How often a fired job re-checks whether its target ledger has closed.
  LEDGER_CONFIRM_POLL_MS: Joi.number().integer().min(100).default(1000),
  // How long to keep polling for a ledger before giving up and leaving the call
  // to the ordinary sweep.
  LEDGER_CONFIRM_TIMEOUT_MS: Joi.number().integer().min(1000).default(120000),
  // Re-time a pending job only if the drift exceeds this, so ordinary velocity
  // noise does not rewrite the queue.
  LEDGER_RETIME_THRESHOLD_MS: Joi.number().integer().min(0).default(1000),
  // How close to expiry a call's target ledger stops being re-derived. 0 means
  // "two ledger intervals", which is what makes the ±1 guarantee hold: a target
  // chosen six hours out on a rough velocity estimate is hundreds of ledgers
  // wrong, while one chosen two intervals out is good to a fraction of one.
  LEDGER_TARGET_LOCK_LEAD_SECONDS: Joi.number().integer().min(0).default(0),
  // How far ahead of expiry a call is given a target ledger.
  LEDGER_SCHEDULE_HORIZON_HOURS: Joi.number().integer().min(1).default(6),
  // Cap on calls armed per sweep.
  LEDGER_SCHEDULE_BATCH_SIZE: Joi.number().integer().min(1).default(200),

  // ── WebSocket gateway (BE-021) ───────────────────────────────────────────
  // Comma-separated origins allowed to open a socket. Empty denies all, which
  // is the safe default: a wildcard origin with credentials would let any site
  // open an authenticated socket as the user.
  WS_CORS_ORIGIN: Joi.string().allow('').default(''),
  // Connection attempts allowed per IP per window. Guards the 10k connection
  // budget against a single source opening thousands of sockets.
  WS_IP_CONNECT_LIMIT: Joi.number().integer().min(1).default(20),
  WS_IP_WINDOW_MS: Joi.number().integer().min(1000).default(60000),
  // Whether x-forwarded-for may be trusted for the per-IP limit. Turn off when
  // the app is exposed directly with no proxy in front of it.
  WS_TRUST_PROXY: Joi.boolean().default(true),
  // Max idle sockets per instance, tuned for the 10k concurrent target.
  WS_MAX_CONNECTIONS: Joi.number().integer().min(1).default(10000),

  // ── Indexer (Base / Base Sepolia) — BE-05 ────────────────────────────────
  BASE_RPC_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .optional(),
  BASE_SEPOLIA_RPC_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .optional(),
  // Polling tunables for Base Data API polling (BE-05)
  BASE_POLL_INTERVAL_MS: Joi.number().integer().min(1000).default(15000),
  BASE_MAX_BLOCK_RANGE: Joi.number().integer().min(100).default(5000),
  BASE_REORG_DEPTH: Joi.number().integer().min(0).default(12),
  CALL_REGISTRY_ADDRESS: Joi.string()
    .pattern(/^0x[0-9a-fA-F]{40}$/)
    .optional()
    .messages({
      'string.pattern.base':
        'CALL_REGISTRY_ADDRESS must be a valid EVM address (0x + 40 hex chars)',
    }),
  // Shared secret used to verify the HMAC-SHA256 X-Signature header on
  // external indexer webhook callbacks (see IndexerWebhookGuard).
  INDEXER_WEBHOOK_SECRET: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.string().min(32).required().messages({
      'any.required': 'INDEXER_WEBHOOK_SECRET is required in production',
      'string.min':
        'INDEXER_WEBHOOK_SECRET must be at least 32 characters in production',
    }),
    otherwise: Joi.string().default('dev-indexer-webhook-secret'),
  }),

  // ── IPFS ───────────────────────────────────────────────────────────────
  IPFS_API_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .default('http://localhost:5001'),
  PINATA_JWT: Joi.string().optional(),

  // ── Admin ──────────────────────────────────────────────────────────────
  ADMIN_API_KEY: Joi.string().optional(),

  // ── Health checks ────────────────────────────────────────────────────────
  // Max number of non-critical dependencies (cache, RPCs, disk) allowed to be
  // down at once before GET /health/ready reports `error` instead of `degraded`.
  HEALTH_DEGRADED_THRESHOLD: Joi.number().min(0).default(1),
  SOROBAN_RPC_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .optional(),
  STELLAR_OUTCOME_MANAGER_CONTRACT_ID: Joi.string().optional().messages({
    'string.base':
      'STELLAR_OUTCOME_MANAGER_CONTRACT_ID must be a valid Stellar contract address (C...)',
  }),

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
