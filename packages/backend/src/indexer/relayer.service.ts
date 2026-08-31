/**
 * relayer.service.ts
 *
 * RelayerService submits signed outcomes to on-chain contracts on both
 * Base (EVM) and Stellar (Soroban) chains.
 *
 * Responsibilities:
 *  - Base: submitOutcome() to OutcomeManager via ethers.js, with managed nonces
 *  - Stellar: submit_outcome() to Soroban via @stellar/stellar-sdk
 *  - Idempotent submission guard: each (callId, chain) pair can only be submitted once
 *  - Audit logging: every submission attempt and result is persisted to audit_logs
 *  - Exponential backoff retry on transient RPC failures
 */

import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ethers } from 'ethers';
import * as StellarSdk from '@stellar/stellar-sdk';
import { AdminService } from '../admin/admin.service';
import { AuditLog } from '../oracle/audit-log.entity';
import { Call } from '../calls/call.entity';
import {
  withRetry,
  RpcExhaustedError,
  RetryOptions,
} from '../common/rpc/rpc-retry.util';

// ─── OutcomeManager ABI (Base / EVM) ───────────────────────────────────────

const OUTCOME_MANAGER_ABI = [
  'function submitOutcome(uint256 callId, bool outcome, uint256 finalPrice, uint256 timestamp, bytes signature) external',
  'function settled(uint256) view returns (bool)',
];

// ─── Result types ───────────────────────────────────────────────────────────

export interface SubmissionResult {
  success: boolean;
  chain: 'base' | 'stellar';
  txHash?: string;
  error?: string;
  callOnchainId: string;
}

// ─── Idempotent submission guard entry ──────────────────────────────────────

interface SubmissionRecord {
  submitted: boolean;
  txHash?: string;
  submittedAt?: Date;
}

// ─── Nonce manager for EVM ─────────────────────────────────────────────────

class NonceManager {
  private readonly logger = new Logger('NonceManager');
  private currentNonce: number | null = null;
  private pendingCount = 0;

  constructor(private readonly provider: ethers.JsonRpcProvider) {}

  async getNextNonce(): Promise<number> {
    if (this.currentNonce === null) {
      this.currentNonce = await this.provider.getTransactionCount('latest');
      this.logger.debug(`Initial nonce fetched: ${this.currentNonce}`);
    }
    const nonce = this.currentNonce + this.pendingCount;
    this.pendingCount++;
    this.logger.debug(`Assigned nonce ${nonce} (${this.pendingCount} pending)`);
    return nonce;
  }

  /** Call after a transaction is confirmed to reset the tracked nonce. */
  async syncNonce(): Promise<void> {
    try {
      const onChain = await this.provider.getTransactionCount('latest');
      this.currentNonce = onChain;
      this.pendingCount = 0;
      this.logger.debug(`Nonce synced to on-chain value: ${onChain}`);
    } catch (err) {
      this.logger.error(`Failed to sync nonce: ${(err as Error).message}`);
    }
  }

  /** Call after a transaction is dropped/replaced to re-fetch from chain. */
  resetNonce(): void {
    this.currentNonce = null;
    this.pendingCount = 0;
    this.logger.debug('Nonce reset — will re-fetch from chain');
  }
}

// ─── Service ────────────────────────────────────────────────────────────────

@Injectable()
export class RelayerService {
  private readonly logger = new Logger(RelayerService.name);

  /** EVM provider & wallet (Base) */
  private provider: ethers.JsonRpcProvider | null = null;
  private wallet: ethers.Wallet | null = null;
  private nonceManager: NonceManager | null = null;
  private outcomeManagerAddress: string | null = null;

  /** Stellar keypair for Soroban submission */
  private stellarKeypair: StellarSdk.Keypair | null = null;
  private stellarServer: StellarSdk.rpc.Server | null = null;
  private stellarOutcomeManagerContractId: string | null = null;

  /** In-memory idempotent submission guard — survives within a process lifetime */
  private readonly submissionGuard = new Map<string, SubmissionRecord>();

  constructor(
    private readonly configService: ConfigService,
    private readonly adminService: AdminService,
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
    @InjectRepository(Call)
    private readonly callRepository: Repository<Call>,
  ) {
    this.initialiseBase();
    this.initialiseStellar();
  }

  // ─── Initialisation helpers ─────────────────────────────────────────────

  private initialiseBase(): void {
    const rpcUrl = this.configService.get<string>('BASE_SEPOLIA_RPC_URL');
    const privateKey = this.configService.get<string>('ORACLE_PRIVATE_KEY');
    this.outcomeManagerAddress =
      this.configService.get<string>('OUTCOME_MANAGER_ADDRESS') ?? null;

    if (rpcUrl && privateKey && this.outcomeManagerAddress) {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
      this.wallet = new ethers.Wallet(privateKey, this.provider);
      this.nonceManager = new NonceManager(this.provider);
      this.logger.log(
        `Base relayer initialised — OutcomeManager: ${this.outcomeManagerAddress}`,
      );
    } else {
      this.logger.warn(
        'Base relayer not initialised (missing RPC URL, private key, or contract address)',
      );
    }
  }

  private initialiseStellar(): void {
    const secretKey = this.configService.get<string>(
      'STELLAR_ORACLE_SECRET_KEY',
    );
    const rpcUrl = this.configService.get<string>(
      'SOROBAN_RPC_URL',
      'https://soroban-testnet.stellar.org',
    );
    this.stellarOutcomeManagerContractId =
      this.configService.get<string>('STELLAR_OUTCOME_MANAGER_CONTRACT_ID') ??
      null;

    if (secretKey) {
      this.stellarKeypair = StellarSdk.Keypair.fromSecret(secretKey);
      this.stellarServer = new StellarSdk.rpc.Server(rpcUrl, {
        allowHttp: rpcUrl.startsWith('http://'),
      });
      this.logger.log(
        `Stellar relayer initialised — oracle: ${this.stellarKeypair.publicKey()}`,
      );
    } else {
      this.logger.warn(
        'Stellar relayer not initialised (missing STELLAR_ORACLE_SECRET_KEY)',
      );
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────

  /**
   * Submit a signed outcome to the specified chain.
   *
   * - Base: sends an EVM transaction to OutcomeManager.submitOutcome()
   * - Stellar: builds and submits a Soroban transaction to submit_outcome()
   *
   * The method is idempotent: if the same callId has already been successfully
   * submitted on this chain, it returns the cached result immediately.
   *
   * @param chain          Target chain ('base' or 'stellar')
   * @param callOnchainId  The on-chain call identifier (string for flexibility)
   * @param callId         The internal DB call ID
   * @param outcome        Whether the prediction was correct
   * @param finalPrice     The final token price
   * @param timestamp      Unix timestamp of the outcome determination
   * @param signature      The hex-encoded (EVM) or base64-encoded (Stellar) signature
   */
  async submitOutcome(
    chain: 'base' | 'stellar',
    callOnchainId: string,
    callId: number,
    outcome: boolean,
    finalPrice: number,
    timestamp: number,
    signature: string,
  ): Promise<SubmissionResult> {
    // Circuit breaker check
    if (this.adminService.isPaused()) {
      const msg = 'Protocol is paused — relayer submissions disabled';
      this.logger.error(msg);
      throw new ServiceUnavailableException(msg);
    }

    // Idempotent guard
    const guardKey = this.buildGuardKey(callOnchainId, chain);
    const existing = this.submissionGuard.get(guardKey);
    if (existing?.submitted) {
      this.logger.log(
        `Idempotent guard hit: callId=${callOnchainId} chain=${chain} — returning cached result`,
      );
      return {
        success: true,
        chain,
        txHash: existing.txHash,
        callOnchainId,
      };
    }

    // Record audit log — attempt started
    await this.recordAuditLog('SUBMISSION_ATTEMPT', {
      chain,
      callOnchainId,
      callId,
      outcome,
      finalPrice,
      timestamp,
    });

    let result: SubmissionResult;

    if (chain === 'base') {
      result = await this.submitToBase(
        callOnchainId,
        callId,
        outcome,
        finalPrice,
        timestamp,
        signature,
      );
    } else {
      result = await this.submitToStellar(
        callOnchainId,
        callId,
        outcome,
        finalPrice,
        timestamp,
        signature,
      );
    }

    // Update idempotent guard
    this.submissionGuard.set(guardKey, {
      submitted: result.success,
      txHash: result.txHash,
      submittedAt: result.success ? new Date() : undefined,
    });

    // Record audit log — submission result
    await this.recordAuditLog(
      result.success ? 'SUBMISSION_SUCCESS' : 'SUBMISSION_FAILED',
      {
        chain,
        callOnchainId,
        callId,
        outcome,
        finalPrice,
        timestamp,
        txHash: result.txHash,
        error: result.error,
      },
    );

    return result;
  }

  /**
   * Check if a given callId + chain has already been submitted.
   */
  isAlreadySubmitted(
    callOnchainId: string,
    chain: 'base' | 'stellar',
  ): boolean {
    const key = this.buildGuardKey(callOnchainId, chain);
    return this.submissionGuard.get(key)?.submitted === true;
  }

  /**
   * Get the submission status for a specific callId + chain.
   */
  getSubmissionStatus(
    callOnchainId: string,
    chain: 'base' | 'stellar',
  ): SubmissionRecord | undefined {
    return this.submissionGuard.get(this.buildGuardKey(callOnchainId, chain));
  }

  /**
   * Manually reset the submission guard for a specific callId + chain.
   * Useful for re-submission after a contract-level revert or admin override.
   */
  resetSubmission(callOnchainId: string, chain: 'base' | 'stellar'): void {
    const key = this.buildGuardKey(callOnchainId, chain);
    this.submissionGuard.delete(key);
    this.logger.warn(
      `Submission guard reset for callId=${callOnchainId} chain=${chain}`,
    );
  }

  /**
   * Check if the Base relayer is configured and ready.
   */
  isBaseReady(): boolean {
    return this.provider !== null && this.wallet !== null;
  }

  /**
   * Check if the Stellar relayer is configured and ready.
   */
  isStellarReady(): boolean {
    return this.stellarKeypair !== null && this.stellarServer !== null;
  }

  // ─── Base (EVM) submission ─────────────────────────────────────────────

  /**
   * Submit outcome to OutcomeManager on Base via ethers.js.
   *
   * Uses managed nonce to avoid nonce collisions, estimates gas, and applies
   * exponential backoff retry on transient RPC failures.
   */
  private async submitToBase(
    callOnchainId: string,
    callId: number,
    outcome: boolean,
    finalPrice: number,
    timestamp: number,
    signature: string,
  ): Promise<SubmissionResult> {
    if (!this.provider || !this.wallet || !this.outcomeManagerAddress) {
      return {
        success: false,
        chain: 'base',
        callOnchainId,
        error: 'Base relayer not initialised — missing configuration',
      };
    }

    const retryOptions: RetryOptions = {
      maxAttempts: 4,
      baseDelayMs: 2_000,
      operationName: `relayer:submitBase:${callOnchainId}`,
    };

    try {
      const txResult = await withRetry(async () => {
        // Nonce management
        const nonce = await this.nonceManager!.getNextNonce();

        // Gas estimation
        const contract = new ethers.Contract(
          this.outcomeManagerAddress!,
          OUTCOME_MANAGER_ABI,
          this.wallet,
        );

        const callIdBN = BigInt(callOnchainId);
        const finalPriceBN = BigInt(Math.floor(finalPrice * 1e18));
        const timestampBN = BigInt(timestamp);

        let gasLimit: bigint;
        try {
          const estimated = await contract.submitOutcome.estimateGas(
            callIdBN,
            outcome,
            finalPriceBN,
            timestampBN,
            signature,
          );
          gasLimit = estimated as unknown as bigint;
          // Add 20% buffer for safety
          gasLimit = (gasLimit * 120n) / 100n;
          this.logger.debug(
            `Gas estimated for call ${callOnchainId}: ${gasLimit.toString()}`,
          );
        } catch (estErr) {
          this.logger.warn(
            `Gas estimation failed for call ${callOnchainId}: ${(estErr as Error).message} — using default`,
          );
          gasLimit = 500_000n; // Default gas limit
        }

        // Build and send transaction
        const txResponse = (await contract.submitOutcome(
          callIdBN,
          outcome,
          finalPriceBN,
          timestampBN,
          signature,
          {
            nonce,
            gasLimit,
          },
        )) as ethers.TransactionResponse;

        this.logger.log(
          `Base tx submitted for call ${callOnchainId}: ${txResponse.hash}`,
        );

        // Wait for confirmation
        const receipt = await txResponse.wait();

        if (!receipt) {
          throw new Error(
            `Transaction ${txResponse.hash} failed — no receipt received`,
          );
        }

        if (receipt.status === 0) {
          throw new Error(
            `Transaction ${txResponse.hash} reverted on-chain (status=0)`,
          );
        }

        // Sync nonce after successful confirmation
        await this.nonceManager!.syncNonce();

        return receipt;
      }, retryOptions);

      return {
        success: true,
        chain: 'base',
        txHash: txResult.hash,
        callOnchainId,
      };
    } catch (err) {
      const errMsg =
        err instanceof RpcExhaustedError
          ? `Exhausted after ${err.attempts} attempts: ${err.lastError.message}`
          : (err as Error).message;

      this.logger.error(
        `Base submission failed for call ${callOnchainId}: ${errMsg}`,
      );

      // Reset nonce on failure to avoid stale nonce issues
      this.nonceManager?.resetNonce();

      return {
        success: false,
        chain: 'base',
        callOnchainId,
        error: errMsg,
      };
    }
  }

  // ─── Stellar (Soroban) submission ──────────────────────────────────────

  /**
   * Submit outcome to OutcomeManager on Stellar via @stellar/stellar-sdk.
   *
   * Builds a Soroban transaction that calls submit_outcome on the
   * outcome_manager contract, signs with the oracle's ed25519 keypair,
   * and submits to the Soroban RPC node with exponential backoff retry.
   */
  private async submitToStellar(
    callOnchainId: string,
    callId: number,
    outcome: boolean,
    finalPrice: number,
    timestamp: number,
    signature: string,
  ): Promise<SubmissionResult> {
    if (!this.stellarKeypair || !this.stellarServer) {
      return {
        success: false,
        chain: 'stellar',
        callOnchainId,
        error: 'Stellar relayer not initialised — missing configuration',
      };
    }

    if (!this.stellarOutcomeManagerContractId) {
      return {
        success: false,
        chain: 'stellar',
        callOnchainId,
        error: 'STELLAR_OUTCOME_MANAGER_CONTRACT_ID not configured',
      };
    }

    const retryOptions: RetryOptions = {
      maxAttempts: 4,
      baseDelayMs: 2_000,
      operationName: `relayer:submitStellar:${callOnchainId}`,
    };

    try {
      const txResult = await withRetry(async () => {
        const sourceAccount = await this.stellarServer!.getAccount(
          this.stellarKeypair!.publicKey(),
        );

        // Build the Soroban invoke contract transaction
        const contract = new StellarSdk.Contract(
          this.stellarOutcomeManagerContractId!,
        );

        // Convert signature to Buffer for Soroban BytesN<64> argument
        const signatureBuffer = Buffer.from(signature, 'base64');
        const signatureBytes = StellarSdk.nativeToScVal(signatureBuffer, {
          type: 'bytes',
        });

        // Build the invoke contract args
        const invokeArgs = [
          StellarSdk.nativeToScVal(BigInt(callOnchainId), { type: 'u64' }),
          StellarSdk.nativeToScVal(outcome, { type: 'bool' }),
          StellarSdk.nativeToScVal(BigInt(Math.floor(finalPrice * 1e7)), {
            type: 'i128',
          }),
          StellarSdk.nativeToScVal(BigInt(timestamp), { type: 'u64' }),
          StellarSdk.nativeToScVal(
            Buffer.from(this.stellarKeypair!.publicKey()),
            { type: 'bytes' },
          ),
          signatureBytes,
        ];

        // Build transaction
        const transactionBuilder = new StellarSdk.TransactionBuilder(
          sourceAccount,
          {
            fee: StellarSdk.BASE_FEE,
            networkPassphrase: StellarSdk.Networks.TESTNET,
          },
        );

        const transaction = transactionBuilder
          .addOperation(contract.call('submit_outcome', ...invokeArgs))
          .setTimeout(StellarSdk.TimeoutInfinite)
          .build();

        // Simulate first to check for errors
        const simulation =
          await this.stellarServer!.simulateTransaction(transaction);

        if (StellarSdk.rpc.Api.isSimulationError(simulation)) {
          throw new Error(`Soroban simulation failed: ${simulation.error}`);
        }

        // Sign the transaction
        transaction.sign(this.stellarKeypair!);

        // Submit to network
        const sendResult =
          await this.stellarServer!.sendTransaction(transaction);

        if (sendResult.status === 'ERROR') {
          throw new Error(
            `Stellar sendTransaction error: ${JSON.stringify(sendResult.errorResult)}`,
          );
        }

        this.logger.log(
          `Stellar tx submitted for call ${callOnchainId}: ${sendResult.hash}`,
        );

        // Poll for confirmation
        const deadline = Date.now() + 60_000; // 60s timeout
        let txResponse: StellarSdk.rpc.Api.GetTransactionResponse;

        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 3_000));
          txResponse = await this.stellarServer!.getTransaction(
            sendResult.hash,
          );

          if (
            txResponse.status ===
            StellarSdk.rpc.Api.GetTransactionStatus.NOT_FOUND
          ) {
            continue; // Still pending
          }

          if (
            txResponse.status ===
            StellarSdk.rpc.Api.GetTransactionStatus.SUCCESS
          ) {
            return { hash: txResponse.txHash };
          }

          // FAILED or other terminal status
          throw new Error(
            `Stellar transaction ${sendResult.hash} failed with status: ${txResponse.status}`,
          );
        }

        throw new Error(
          `Stellar transaction ${sendResult.hash} timed out after 60s`,
        );
      }, retryOptions);

      return {
        success: true,
        chain: 'stellar',
        txHash: txResult.hash,
        callOnchainId,
      };
    } catch (err) {
      const errMsg =
        err instanceof RpcExhaustedError
          ? `Exhausted after ${err.attempts} attempts: ${err.lastError.message}`
          : (err as Error).message;

      this.logger.error(
        `Stellar submission failed for call ${callOnchainId}: ${String(errMsg)}`,
      );

      return {
        success: false,
        chain: 'stellar',
        callOnchainId,
        error: errMsg,
      };
    }
  }

  // ─── Audit logging ─────────────────────────────────────────────────────

  /**
   * Persist an audit log entry for submission tracking.
   * Non-blocking: errors in audit logging are caught and logged but do not
   * affect the submission result.
   */
  private async recordAuditLog(
    action: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      const entry = this.auditLogRepository.create({
        action,
        actor: 'relayer-service',
        targetResource: `call:${String(payload.callOnchainId)}`,
        payload,
      });
      await this.auditLogRepository.save(entry);
    } catch (err) {
      this.logger.error(
        `Failed to record audit log for action "${action}": ${(err as Error).message}`,
      );
    }
  }

  // ─── Guard helpers ─────────────────────────────────────────────────────

  private buildGuardKey(callOnchainId: string, chain: string): string {
    return `${chain}:${callOnchainId}`;
  }
}
