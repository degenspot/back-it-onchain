/**
 * multi-outcome-event.service.ts  (BE-003)
 *
 * Decodes, validates, and atomically persists Soroban multi-outcome contract
 * events: CallCreated, StakeAdded, OutcomeSubmitted, PayoutWithdrawn.
 *
 * Design
 * ──────
 *  - Receives a ParsedSorobanEvent (already SCVal-decoded by StellarIndexerService)
 *    and maps its data into relational entities.
 *  - Supports up to 32 outcome slots per call (Soroban contract constraint).
 *  - All monetary amounts flow through BigInt arithmetic and are stored as
 *    DECIMAL(36,0) strings — zero precision loss regardless of stake size.
 *  - Each event type is processed inside a QueryRunner transaction so
 *    partial writes never leak to downstream consumers.
 *  - Emits typed NestJS domain events after successful commit so badges,
 *    analytics, and notifications can react without coupling.
 *
 * Event structures (decoded from SCVal)
 * ──────────────────────────────────────
 *  CallCreated  { call_id, creator, outcomes: string[], end_time, token }
 *  StakeAdded   { call_id, staker, outcome_index, amount }
 *  OutcomeSubmitted { call_id, submitter, winning_outcome_index, evidence_cid }
 *  PayoutWithdrawn  { call_id, winner, amount, outcome_index }
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, QueryRunner } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { Call, ChainType } from '../entities/call.entity';
import { OutcomePool } from '../entities/outcome-pool.entity';
import { ParticipantStake } from '../entities/participant-stake.entity';
import { ParsedSorobanEvent } from './stellar-indexer.service';

// ─── Max outcomes per call (contract constraint) ──────────────────────────────
const MAX_OUTCOMES = 32;

// ─── Domain event names ───────────────────────────────────────────────────────
export const MULTI_OUTCOME_EVENTS = {
  CALL_CREATED: 'multiOutcome.CallCreated',
  STAKE_ADDED: 'multiOutcome.StakeAdded',
  OUTCOME_SUBMITTED: 'multiOutcome.OutcomeSubmitted',
  PAYOUT_WITHDRAWN: 'multiOutcome.PayoutWithdrawn',
} as const;

// ─── Decoded payload shapes ───────────────────────────────────────────────────

interface CallCreatedPayload {
  call_id: string;
  creator: string;
  outcomes: string[];
  end_time?: string;
  token?: string;
}

interface StakeAddedPayload {
  call_id: string;
  staker: string;
  outcome_index: number;
  amount: string; // decimal string (BigInt-safe)
}

interface OutcomeSubmittedPayload {
  call_id: string;
  submitter: string;
  winning_outcome_index: number;
  evidence_cid?: string;
}

interface PayoutWithdrawnPayload {
  call_id: string;
  winner: string;
  amount: string;
  outcome_index: number;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class MultiOutcomeEventService {
  private readonly logger = new Logger(MultiOutcomeEventService.name);

  constructor(
    @InjectRepository(Call)
    private readonly callRepo: Repository<Call>,
    @InjectRepository(OutcomePool)
    private readonly outcomePoolRepo: Repository<OutcomePool>,
    @InjectRepository(ParticipantStake)
    private readonly stakeRepo: Repository<ParticipantStake>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ── Public entry point ────────────────────────────────────────────────────

  /**
   * Routes a decoded Soroban event to the correct handler.
   * Unknown event types are silently skipped (logged at debug level).
   */
  async handleEvent(event: ParsedSorobanEvent): Promise<void> {
    switch (event.type) {
      case 'CallCreated':
        await this.handleCallCreated(event);
        break;
      case 'StakeAdded':
        await this.handleStakeAdded(event);
        break;
      case 'OutcomeSubmitted':
        await this.handleOutcomeSubmitted(event);
        break;
      case 'PayoutWithdrawn':
        await this.handlePayoutWithdrawn(event);
        break;
      default:
        this.logger.debug(`MultiOutcomeEventService: ignoring unknown event type "${event.type}"`);
    }
  }

  // ── CallCreated ───────────────────────────────────────────────────────────

  /**
   * Persists a new call row and creates one OutcomePool row per outcome slot.
   * Idempotent: if a call with the same (chain, callOnchainId) already exists
   * the row is updated (not duplicated) and pool rows are upserted.
   */
  private async handleCallCreated(event: ParsedSorobanEvent): Promise<void> {
    const payload = this.extractCallCreated(event.data);
    if (!payload) {
      this.logger.warn(`CallCreated: could not parse payload from event ${event.txHash}`);
      return;
    }

    this.validateOutcomeCount(payload.outcomes, event.txHash);

    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    try {
      // Upsert the call row
      let call = await runner.manager.findOne(Call, {
        where: { chain: ChainType.STELLAR, callOnchainId: payload.call_id },
      });

      if (!call) {
        call = runner.manager.create(Call, {
          chain: ChainType.STELLAR,
          callOnchainId: payload.call_id,
          txHash: event.txHash,
          contractId: event.contractId,
          stellarContractId: event.contractId,
          eventType: 'CallCreated',
          ledgerHeight: event.ledger,
          blockHash: event.blockHash,
          eventData: event.data,
          isOrphaned: false,
        });
      } else {
        call.ledgerHeight = event.ledger;
        call.blockHash = event.blockHash;
        call.isOrphaned = false;
      }
      call = await runner.manager.save(Call, call);

      // Create / update outcome pool rows
      for (let i = 0; i < payload.outcomes.length; i++) {
        let pool = await runner.manager.findOne(OutcomePool, {
          where: {
            callOnchainId: payload.call_id,
            chain: 'stellar',
            outcomeIndex: i,
          },
        });

        if (!pool) {
          pool = runner.manager.create(OutcomePool, {
            callOnchainId: payload.call_id,
            chain: 'stellar',
            outcomeIndex: i,
            outcomeLabel: payload.outcomes[i] ?? `outcome_${i}`,
            totalStake: '0',
            participantCount: 0,
            ledgerHeight: event.ledger,
            blockHash: event.blockHash,
            isOrphaned: false,
          });
          await runner.manager.save(OutcomePool, pool);
        }
      }

      await runner.commitTransaction();

      this.logger.log(
        `CallCreated: persisted call ${payload.call_id} with ${payload.outcomes.length} outcomes @ ledger ${event.ledger}`,
      );

      this.eventEmitter.emit(MULTI_OUTCOME_EVENTS.CALL_CREATED, {
        callId: call.id,
        callOnchainId: payload.call_id,
        creator: payload.creator,
        outcomes: payload.outcomes,
        ledger: event.ledger,
        txHash: event.txHash,
      });
    } catch (err) {
      await runner.rollbackTransaction();
      this.logger.error(`CallCreated handler rolled back: ${(err as Error).message}`);
      throw err;
    } finally {
      await runner.release();
    }
  }

  // ── StakeAdded ────────────────────────────────────────────────────────────

  /**
   * Atomically adds the new stake to the correct OutcomePool bucket and
   * upserts the ParticipantStake row.
   *
   * Uses BigInt arithmetic throughout so precision is preserved at every step:
   *   newPoolTotal = BigInt(existingTotal) + BigInt(incomingAmount)
   */
  private async handleStakeAdded(event: ParsedSorobanEvent): Promise<void> {
    const payload = this.extractStakeAdded(event.data);
    if (!payload) {
      this.logger.warn(`StakeAdded: could not parse payload from event ${event.txHash}`);
      return;
    }

    if (payload.outcome_index < 0 || payload.outcome_index >= MAX_OUTCOMES) {
      this.logger.error(
        `StakeAdded: outcome_index ${payload.outcome_index} out of range (max ${MAX_OUTCOMES - 1})`,
      );
      return;
    }

    const stakeAmountBig = BigInt(payload.amount);

    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    try {
      // Update the pool balance
      const pool = await runner.manager.findOne(OutcomePool, {
        where: {
          callOnchainId: payload.call_id,
          chain: 'stellar',
          outcomeIndex: payload.outcome_index,
        },
      });

      if (pool) {
        const prevTotal = BigInt(pool.totalStake ?? '0');
        pool.totalStake = (prevTotal + stakeAmountBig).toString();
        pool.ledgerHeight = event.ledger;
        pool.blockHash = event.blockHash;
        await runner.manager.save(OutcomePool, pool);
      } else {
        this.logger.warn(
          `StakeAdded: no OutcomePool found for call ${payload.call_id} index ${payload.outcome_index} — creating on-the-fly`,
        );
        const newPool = runner.manager.create(OutcomePool, {
          callOnchainId: payload.call_id,
          chain: 'stellar',
          outcomeIndex: payload.outcome_index,
          totalStake: stakeAmountBig.toString(),
          participantCount: 1,
          ledgerHeight: event.ledger,
          blockHash: event.blockHash,
          isOrphaned: false,
        });
        await runner.manager.save(OutcomePool, newPool);
      }

      // Upsert participant stake row
      let stake = await runner.manager.findOne(ParticipantStake, {
        where: {
          callOnchainId: payload.call_id,
          chain: 'stellar',
          wallet: payload.staker,
          outcomeIndex: payload.outcome_index,
        },
      });

      if (stake) {
        const prevStake = BigInt(stake.stakeAmount ?? '0');
        stake.stakeAmount = (prevStake + stakeAmountBig).toString();
        stake.lastLedgerHeight = event.ledger;
        stake.lastTxHash = event.txHash;
      } else {
        stake = runner.manager.create(ParticipantStake, {
          callOnchainId: payload.call_id,
          chain: 'stellar',
          wallet: payload.staker,
          outcomeIndex: payload.outcome_index,
          stakeAmount: stakeAmountBig.toString(),
          lastLedgerHeight: event.ledger,
          lastTxHash: event.txHash,
          isOrphaned: false,
        });
        // Increment participant count on the pool
        if (pool) {
          pool.participantCount = (pool.participantCount ?? 0) + 1;
          await runner.manager.save(OutcomePool, pool);
        }
      }
      await runner.manager.save(ParticipantStake, stake);

      // Also upsert the raw event in the calls table for searchability
      const callRow = runner.manager.create(Call, {
        chain: ChainType.STELLAR,
        txHash: event.txHash,
        contractId: event.contractId,
        stellarContractId: event.contractId,
        callOnchainId: payload.call_id,
        eventType: 'StakeAdded',
        eventSequence: event.sequence,
        ledgerHeight: event.ledger,
        blockHash: event.blockHash,
        eventData: event.data,
        isOrphaned: false,
      });
      await runner.manager.save(Call, callRow);

      await runner.commitTransaction();

      this.logger.log(
        `StakeAdded: ${payload.staker} staked ${payload.amount} on outcome ${payload.outcome_index} for call ${payload.call_id} @ ledger ${event.ledger}`,
      );

      this.eventEmitter.emit(MULTI_OUTCOME_EVENTS.STAKE_ADDED, {
        callOnchainId: payload.call_id,
        staker: payload.staker,
        outcomeIndex: payload.outcome_index,
        amount: payload.amount,
        ledger: event.ledger,
        txHash: event.txHash,
      });
    } catch (err) {
      await runner.rollbackTransaction();
      this.logger.error(`StakeAdded handler rolled back: ${(err as Error).message}`);
      throw err;
    } finally {
      await runner.release();
    }
  }

  // ── OutcomeSubmitted ──────────────────────────────────────────────────────

  private async handleOutcomeSubmitted(event: ParsedSorobanEvent): Promise<void> {
    const payload = this.extractOutcomeSubmitted(event.data);
    if (!payload) {
      this.logger.warn(`OutcomeSubmitted: could not parse payload from event ${event.txHash}`);
      return;
    }

    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    try {
      // Update call status → SETTLING and record winning outcome
      const call = await runner.manager.findOne(Call, {
        where: { chain: ChainType.STELLAR, callOnchainId: payload.call_id },
      });

      if (call) {
        call.status = 'SETTLING';
        call.eventData = {
          ...(call.eventData ?? {}),
          winningOutcomeIndex: payload.winning_outcome_index,
          submitter: payload.submitter,
          evidenceCid: payload.evidence_cid,
        };
        call.ledgerHeight = event.ledger;
        await runner.manager.save(Call, call);
      }

      // Raw event row
      const eventRow = runner.manager.create(Call, {
        chain: ChainType.STELLAR,
        txHash: event.txHash,
        contractId: event.contractId,
        stellarContractId: event.contractId,
        callOnchainId: payload.call_id,
        eventType: 'OutcomeSubmitted',
        eventSequence: event.sequence,
        ledgerHeight: event.ledger,
        blockHash: event.blockHash,
        eventData: event.data,
        isOrphaned: false,
      });
      await runner.manager.save(Call, eventRow);

      await runner.commitTransaction();

      this.logger.log(
        `OutcomeSubmitted: call ${payload.call_id} → outcome ${payload.winning_outcome_index} @ ledger ${event.ledger}`,
      );

      this.eventEmitter.emit(MULTI_OUTCOME_EVENTS.OUTCOME_SUBMITTED, {
        callOnchainId: payload.call_id,
        submitter: payload.submitter,
        winningOutcomeIndex: payload.winning_outcome_index,
        evidenceCid: payload.evidence_cid,
        ledger: event.ledger,
        txHash: event.txHash,
      });
    } catch (err) {
      await runner.rollbackTransaction();
      this.logger.error(`OutcomeSubmitted handler rolled back: ${(err as Error).message}`);
      throw err;
    } finally {
      await runner.release();
    }
  }

  // ── PayoutWithdrawn ───────────────────────────────────────────────────────

  private async handlePayoutWithdrawn(event: ParsedSorobanEvent): Promise<void> {
    const payload = this.extractPayoutWithdrawn(event.data);
    if (!payload) {
      this.logger.warn(`PayoutWithdrawn: could not parse payload from event ${event.txHash}`);
      return;
    }

    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    try {
      // Raw event row
      const eventRow = runner.manager.create(Call, {
        chain: ChainType.STELLAR,
        txHash: event.txHash,
        contractId: event.contractId,
        stellarContractId: event.contractId,
        callOnchainId: payload.call_id,
        eventType: 'PayoutWithdrawn',
        eventSequence: event.sequence,
        ledgerHeight: event.ledger,
        blockHash: event.blockHash,
        eventData: {
          ...event.data,
          winner: payload.winner,
          amount: payload.amount,
          outcomeIndex: payload.outcome_index,
        },
        isOrphaned: false,
      });
      await runner.manager.save(Call, eventRow);

      await runner.commitTransaction();

      this.logger.log(
        `PayoutWithdrawn: ${payload.winner} withdrew ${payload.amount} for call ${payload.call_id} @ ledger ${event.ledger}`,
      );

      this.eventEmitter.emit(MULTI_OUTCOME_EVENTS.PAYOUT_WITHDRAWN, {
        callOnchainId: payload.call_id,
        winner: payload.winner,
        amount: payload.amount,
        outcomeIndex: payload.outcome_index,
        ledger: event.ledger,
        txHash: event.txHash,
      });
    } catch (err) {
      await runner.rollbackTransaction();
      this.logger.error(`PayoutWithdrawn handler rolled back: ${(err as Error).message}`);
      throw err;
    } finally {
      await runner.release();
    }
  }

  // ── Payload extractors ────────────────────────────────────────────────────

  /**
   * Attempts to extract CallCreated payload from decoded SCVal data.
   * Tolerates both direct-key and nested `value` map layouts.
   */
  private extractCallCreated(
    data: Record<string, unknown>,
  ): CallCreatedPayload | null {
    try {
      // Layout 1: flat map — { call_id, creator, outcomes, end_time, token }
      // Layout 2: nested under `value` key
      const source = (data['value'] as Record<string, unknown>) ?? data;

      const call_id = String(
        source['call_id'] ?? source['callId'] ?? source['id'] ?? '',
      );
      const creator = String(source['creator'] ?? '');
      const rawOutcomes = source['outcomes'] ?? source['outcome_labels'] ?? [];
      const outcomes = Array.isArray(rawOutcomes)
        ? rawOutcomes.map(String)
        : [String(rawOutcomes)];

      if (!call_id) return null;

      return {
        call_id,
        creator,
        outcomes,
        end_time: source['end_time'] != null ? String(source['end_time']) : undefined,
        token: source['token'] != null ? String(source['token']) : undefined,
      };
    } catch {
      return null;
    }
  }

  private extractStakeAdded(
    data: Record<string, unknown>,
  ): StakeAddedPayload | null {
    try {
      const source = (data['value'] as Record<string, unknown>) ?? data;

      const call_id = String(source['call_id'] ?? source['callId'] ?? '');
      const staker = String(source['staker'] ?? source['wallet'] ?? '');
      const outcome_index = Number(
        source['outcome_index'] ?? source['outcomeIndex'] ?? 0,
      );
      // Accept the amount from multiple possible field names
      const rawAmount =
        source['amount'] ??
        source['stake_amount'] ??
        source['stakeAmount'] ??
        '0';
      const amount = String(rawAmount);

      if (!call_id || !staker) return null;
      // Validate BigInt parsability
      BigInt(amount);

      return { call_id, staker, outcome_index, amount };
    } catch {
      return null;
    }
  }

  private extractOutcomeSubmitted(
    data: Record<string, unknown>,
  ): OutcomeSubmittedPayload | null {
    try {
      const source = (data['value'] as Record<string, unknown>) ?? data;

      const call_id = String(source['call_id'] ?? source['callId'] ?? '');
      const submitter = String(source['submitter'] ?? '');
      const winning_outcome_index = Number(
        source['winning_outcome_index'] ??
          source['winningOutcomeIndex'] ??
          source['outcome_index'] ??
          0,
      );

      if (!call_id) return null;

      return {
        call_id,
        submitter,
        winning_outcome_index,
        evidence_cid: source['evidence_cid'] != null
          ? String(source['evidence_cid'])
          : undefined,
      };
    } catch {
      return null;
    }
  }

  private extractPayoutWithdrawn(
    data: Record<string, unknown>,
  ): PayoutWithdrawnPayload | null {
    try {
      const source = (data['value'] as Record<string, unknown>) ?? data;

      const call_id = String(source['call_id'] ?? source['callId'] ?? '');
      const winner = String(source['winner'] ?? source['wallet'] ?? '');
      const rawAmount = source['amount'] ?? source['payout'] ?? '0';
      const amount = String(rawAmount);
      const outcome_index = Number(source['outcome_index'] ?? source['outcomeIndex'] ?? 0);

      if (!call_id || !winner) return null;
      BigInt(amount);

      return { call_id, winner, amount, outcome_index };
    } catch {
      return null;
    }
  }

  // ── Validation ────────────────────────────────────────────────────────────

  private validateOutcomeCount(outcomes: string[], txHash: string): void {
    if (outcomes.length > MAX_OUTCOMES) {
      throw new Error(
        `CallCreated event ${txHash} declares ${outcomes.length} outcomes (max ${MAX_OUTCOMES})`,
      );
    }
    if (outcomes.length === 0) {
      throw new Error(`CallCreated event ${txHash} has no outcomes`);
    }
  }

  // ── Query helpers ─────────────────────────────────────────────────────────

  async getOutcomePools(callOnchainId: string): Promise<OutcomePool[]> {
    return this.outcomePoolRepo.find({
      where: { callOnchainId, isOrphaned: false },
      order: { outcomeIndex: 'ASC' },
    });
  }

  async getParticipantStakes(
    callOnchainId: string,
    wallet?: string,
  ): Promise<ParticipantStake[]> {
    const where: Record<string, unknown> = { callOnchainId, isOrphaned: false };
    if (wallet) where['wallet'] = wallet;
    return this.stakeRepo.find({ where, order: { outcomeIndex: 'ASC' } });
  }
}
