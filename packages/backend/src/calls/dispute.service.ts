/**
 * dispute.service.ts  (BE-019)
 *
 * Dispute tracking, staking, and escalation to a governance multisig.
 *
 * The shape of the thing
 * ─────────────────────
 * A call is settled by the oracle and stays settled, but a settlement can be
 * wrong — the feed was manipulated, the condition was misread, the price was
 * thin. So a settled call gets a 24 h window in which anyone who disagrees can
 * stake a bond to say so. Stakes are what make this more than a comment box:
 *
 *   - a dispute nobody will back is noise, and the bond is what makes backing
 *     it cost something;
 *   - once enough value is staked to clear the escalation threshold, the
 *     decision moves out of the hands of stakers and into a governance
 *     multisig, because at that point the money at stake justifies more than a
 *     vote among the people with a position.
 *
 * Anti-spam
 * ─────────
 * Two mechanisms, because they stop different things:
 *
 *   1. A minimum bond per staker, so filing a dispute costs real value. This is
 *      the issue's "minimum bond requirements" requirement.
 *   2. One active dispute per call. Additional backers *join* the existing
 *      dispute rather than opening parallel ones. Without this, a threshold
 *      measured per dispute could be met by filing the same amount fifty times,
 *      which would make the threshold meaningless.
 *
 * Failure directions
 * ──────────────────
 * Every ambiguous outcome resolves in favour of the original resolution:
 *
 *   - window expires without the threshold → CONFIRMED
 *   - governance does not reach quorum before the deadline → CONFIRMED
 *   - governance quorum is reached but split → no decision, then CONFIRMED
 *   - staker slashed → slashed
 *
 * A dispute system that defaults to "overturn" whenever it is confused is a
 * denial-of-service on the oracle, so the default here is the opposite: the
 * only way to overturn a settlement is for a quorum of governance signers to
 * say so explicitly.
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { formatUnits, parseUnits } from 'ethers';
import { DataSource, EntityManager, In, LessThan, Repository } from 'typeorm';
import { Call } from './call.entity';
import {
  Dispute,
  DisputeOutcomeReason,
  DisputeStatus,
} from './dispute.entity';
import { DisputeStake, StakeStatus } from './dispute-stake.entity';
import {
  DisputeEvidence,
  EvidenceKind,
} from './dispute-evidence.entity';
import {
  DisputeApproval,
  GovernanceDecision,
} from './dispute-approval.entity';
import { AuditLogService } from '../oracle/audit-log.service';
import { AuditLogAction } from '../oracle/audit-log.entity';

export interface DisputeConfig {
  /** Stake needed to open or add to a dispute. */
  minBond: string;
  /** Aggregate stake that escalates a dispute to governance. */
  stakeThreshold: string;
  /** Hours after settlement during which disputes may be lodged. */
  windowHours: number;
  /** Hours governance has to reach a decision once escalated. */
  voteDurationHours: number;
  /** Approvals required to decide an escalated dispute. */
  governanceQuorum: number;
}

export interface RaiseDisputeInput {
  raiserWallet: string;
  claim: string;
  bondAmount: string;
  claimCid?: string;
}

export interface AddStakeInput {
  stakerWallet: string;
  amount: string;
}

export interface AddEvidenceInput {
  submitterWallet: string;
  cid: string;
  description?: string;
}

export interface RecordVoteInput {
  signerWallet: string;
  decision: GovernanceDecision;
  note?: string;
}

const DECIMALS = 18;

@Injectable()
export class DisputeService {
  private readonly logger = new Logger(DisputeService.name);

  constructor(
    @InjectRepository(Dispute)
    private readonly disputes: Repository<Dispute>,
    @InjectRepository(DisputeStake)
    private readonly stakes: Repository<DisputeStake>,
    @InjectRepository(DisputeEvidence)
    private readonly evidence: Repository<DisputeEvidence>,
    @InjectRepository(DisputeApproval)
    private readonly approvals: Repository<DisputeApproval>,
    @InjectRepository(Call)
    private readonly calls: Repository<Call>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly auditLog: AuditLogService,
  ) {}

  // ─── Configuration ───────────────────────────────────────────────────────

  getConfig(): DisputeConfig {
    return {
      minBond: this.configService.get<string>(
        'DISPUTE_MIN_BOND',
        '10',
      ),
      stakeThreshold: this.configService.get<string>(
        'DISPUTE_STAKE_THRESHOLD',
        '100',
      ),
      windowHours: this.configService.get<number>(
        'DISPUTE_WINDOW_HOURS',
        24,
      ),
      voteDurationHours: this.configService.get<number>(
        'DISPUTE_VOTE_DURATION_HOURS',
        48,
      ),
      governanceQuorum: this.configService.get<number>(
        'DISPUTE_GOVERNANCE_QUORUM',
        3,
      ),
    };
  }

  // ─── Fixed-point helpers ─────────────────────────────────────────────────

  /**
   * Bonds are 18-decimal fixed-point values. They are held as strings and
   * compared as BigInt, because a JS number silently rounds a bond and a
   * rounded bond is a wrong payout.
   */
  private toUnits(amount: string): bigint {
    try {
      return parseUnits(amount, DECIMALS);
    } catch {
      throw new BadRequestException(
        `Bond amount "${amount}" is not a valid decimal`,
      );
    }
  }

  private toDecimal(units: bigint): string {
    return formatUnits(units, DECIMALS);
  }

  // ─── Raising a dispute ───────────────────────────────────────────────────

  /**
   * Lodge a dispute against a settled call, or back one that already exists.
   *
   * Returns the dispute and whether this call created it, so a caller can tell
   * "your dispute is open" from "your stake joined an existing dispute".
   */
  async raiseDispute(
    callId: number,
    input: RaiseDisputeInput,
  ): Promise<{ dispute: Dispute; created: boolean }> {
    if (!input.raiserWallet) {
      throw new BadRequestException('A raiser wallet is required');
    }
    if (!input.claim?.trim()) {
      throw new BadRequestException('A dispute claim is required');
    }

    const bond = this.toUnits(input.bondAmount);
    this.assertMeetsMinimumBond(bond);

    // -- Atomicity ----------------------------------------------------------
    // Everything that has to hold together runs in one transaction, under a
    // pessimistic lock on the call row:
    //
    //   * the dispute, its first stake, its claim evidence and the call's own
    //     status/activeDisputeId are written together. Failing halfway would
    //     otherwise leave a dispute with no stake behind it -- an OPEN dispute
    //     nobody is bonded to, which is not a state the rest of this file knows
    //     how to reason about.
    //   * the lock is what makes "one active dispute per call" actually hold.
    //     Every check below happens *after* the lock is taken, so a concurrent
    //     raise for the same call waits here and then joins the existing
    //     dispute instead of opening a parallel one. (The partial unique index
    //     on active disputes is the second line of defence; the lock is what
    //     turns the loser of that race into a clean join, not an error.)
    const result = await this.dataSource.transaction(async (manager) => {
      const disputeRepo = manager.getRepository(Dispute);
      const stakeRepo = manager.getRepository(DisputeStake);
      const callRepo = manager.getRepository(Call);

      const call = await callRepo.findOne({
        where: { id: callId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!call) throw new NotFoundException(`Call ${callId} not found`);

      // Re-read under the lock: the read before the transaction is only a fast
      // path, and may already be stale by the time the lock is granted.
      const existing = await disputeRepo.findOne({
        where: { callId, status: In(['OPEN', 'VOTING']) },
        order: { raisedAt: 'DESC' },
      });
      if (existing) {
        this.assertWindowOpen(existing);
        await this.applyStake(manager, existing, {
          stakerWallet: input.raiserWallet,
          amount: bond,
        });
        if (input.claimCid) {
          await this.applyEvidence(manager, existing, {
            submitterWallet: input.raiserWallet,
            cid: input.claimCid,
            description: 'Additional claim',
            kind: 'CLAIM',
          });
        }
        return { created: false as const, dispute: existing, call };
      }

      const settlement = call.settledAt ?? call.statusUpdatedAt;
      if (!settlement) {
        throw new BadRequestException(
          `Call ${callId} has no recorded settlement time, so its dispute ` +
            'window cannot be determined',
        );
      }

      const windowHours = this.getConfig().windowHours;
      const windowExpiresAt = new Date(
        settlement.getTime() + windowHours * 60 * 60 * 1_000,
      );
      if (new Date() > windowExpiresAt) {
        throw new BadRequestException(
          `The ${windowHours}h dispute window for call ${callId} closed at ` +
            `${windowExpiresAt.toISOString()}`,
        );
      }

      if (call.status !== 'SETTLED') {
        throw new BadRequestException(
          `Call ${callId} is ${call.status}; only a SETTLED call can be disputed`,
        );
      }

      const bondDecimal = this.toDecimal(bond);
      const saved = await disputeRepo.save(
        disputeRepo.create({
          callId,
          raiserWallet: input.raiserWallet,
          claim: input.claim.trim(),
          claimCid: input.claimCid ?? null,
          bondAmount: bondDecimal,
          // The raiser's bond *is* the opening total; there is no separate
          // running sum that has to catch up with it.
          totalBond: bondDecimal,
          status: 'OPEN',
          windowExpiresAt,
          votingStartedAt: null,
          voteDeadlineAt: null,
          decidedAt: null,
          governanceQuorum: null,
          resolvedBy: null,
          upheld: null,
          resolutionNote: null,
        }),
      );

      await stakeRepo.save(
        stakeRepo.create({
          disputeId: saved.id,
          stakerWallet: input.raiserWallet,
          amount: bondDecimal,
          status: 'ACTIVE',
          settledAt: null,
        }),
      );

      if (input.claimCid) {
        await this.applyEvidence(manager, saved, {
          submitterWallet: input.raiserWallet,
          cid: input.claimCid,
          description: input.claim.slice(0, 280),
          kind: 'CLAIM',
        });
      }

      call.activeDisputeId = saved.id;
      call.disputedAt = new Date();
      call.status = 'DISPUTED';
      call.statusUpdatedAt = new Date();
      await callRepo.save(call);

      return { created: true as const, dispute: saved, call };
    });

    const { created, dispute: saved, call } = result;

    // Audit, events, and escalation deliberately sit *outside* the transaction.
    // A websocket broadcast or an HTTP webhook issued from inside one would go
    // out for a write that may still roll back, and the row lock would be held
    // for the whole of that I/O.
    await this.auditLog.append({
      callId: String(callId),
      action: AuditLogAction.DISPUTE_RAISED,
      actor: input.raiserWallet,
      evidenceCid: input.claimCid,
      payloadHash: JSON.stringify({
        disputeId: saved.id,
        bond: this.toDecimal(bond),
        windowExpiresAt: saved.windowExpiresAt.toISOString(),
        joinedExisting: !created,
      }),
    });

    this.eventEmitter.emit('dispute.raised', {
      marketId: String(call.callOnchainId ?? callId),
      callId: String(callId),
      disputeId: saved.id,
      staker: input.raiserWallet,
      bondAmount: this.toDecimal(bond),
      disputedAt: Date.now(),
    });

    // The first backer may already clear the threshold on their own, and a
    // later backer may be the one who pushes an existing dispute over it.
    await this.maybeEscalate(saved.id);

    return { dispute: await this.findById(saved.id), created };
  }

  /**
   * Record one staker's bond and fold it into the dispute total.
   *
   * Takes an EntityManager so the caller chooses the transaction boundary. The
   * total is recomputed from the stake rows instead of being incremented: a
   * lost increment would permanently skew the aggregate, and the aggregate is
   * what decides whether governance gets involved.
   */
  private async applyStake(
    manager: EntityManager,
    dispute: Dispute,
    input: { stakerWallet: string; amount: bigint },
  ): Promise<void> {
    const stakeRepo = manager.getRepository(DisputeStake);
    const disputeRepo = manager.getRepository(Dispute);

    const already = await stakeRepo.findOne({
      where: { disputeId: dispute.id, stakerWallet: input.stakerWallet },
    });
    if (already && already.status === 'ACTIVE') {
      throw new BadRequestException(
        `${input.stakerWallet} has already staked on this dispute`,
      );
    }

    await stakeRepo.save(
      stakeRepo.create({
        disputeId: dispute.id,
        stakerWallet: input.stakerWallet,
        amount: this.toDecimal(input.amount),
        status: 'ACTIVE',
        settledAt: null,
      }),
    );

    dispute.totalBond = await this.recomputeTotalBond(stakeRepo, dispute.id);
    await disputeRepo.save(dispute);
  }

  /** Persist one piece of evidence. See {@link applyStake} for the why. */
  private async applyEvidence(
    manager: EntityManager,
    dispute: Dispute,
    input: {
      submitterWallet: string;
      cid: string;
      description?: string;
      kind: EvidenceKind;
    },
  ): Promise<DisputeEvidence> {
    const evidenceRepo = manager.getRepository(DisputeEvidence);
    const saved = await evidenceRepo.save(
      evidenceRepo.create({
        disputeId: dispute.id,
        submitterWallet: input.submitterWallet,
        kind: input.kind,
        cid: input.cid.trim(),
        description: input.description ?? null,
      }),
    );

    if (input.kind === 'COUNTER') {
      this.eventEmitter.emit('dispute.counter_evidence', {
        disputeId: dispute.id,
        callId: String(dispute.callId),
        submitter: input.submitterWallet,
        cid: saved.cid,
      });
    }
    return saved;
  }

  private assertMeetsMinimumBond(bond: bigint): void {
    const min = this.toUnits(this.getConfig().minBond);
    if (bond < min) {
      throw new BadRequestException(
        `Bond of ${this.toDecimal(bond)} is below the minimum of ` +
          `${this.toDecimal(min)} required to open or back a dispute`,
      );
    }
  }

  // ─── Backing an existing dispute ─────────────────────────────────────────

  /** Add stake to an open dispute, escalating it if the threshold is crossed. */
  async addStake(
    disputeId: string,
    input: AddStakeInput,
  ): Promise<Dispute> {
    const dispute = await this.findById(disputeId);
    this.assertOpen(dispute, 'stake a dispute');
    this.assertWindowOpen(dispute);

    const amount = this.toUnits(input.amount);
    this.assertMeetsMinimumBond(amount);

    await this.applyStake(this.dataSource.manager, dispute, {
      stakerWallet: input.stakerWallet,
      amount,
    });

    await this.maybeEscalate(disputeId);
    return this.findById(disputeId);
  }

  private async recomputeTotalBond(
    stakeRepo: Repository<DisputeStake>,
    disputeId: string,
  ): Promise<string> {
    const rows = await stakeRepo.find({
      where: { disputeId, status: 'ACTIVE' },
    });
    const total = rows.reduce((sum, row) => sum + this.toUnits(row.amount), 0n);
    return this.toDecimal(total);
  }

  // ─── Counter-evidence ────────────────────────────────────────────────────

  /**
   * Attach evidence to a dispute.
   *
   * Counter-evidence is accepted from anyone, not just stakers: a ruling
   * against a dispute can be challenged, and requiring a bond to submit
   * evidence would let a well-funded side simply bury the other side's
   * argument. The dispute outcome is decided by stake and governance, not by
   * who filed the most paperwork.
   */
  async attachEvidence(
    disputeId: string,
    input: AddEvidenceInput,
  ): Promise<DisputeEvidence> {
    const dispute = await this.findById(disputeId);
    if (dispute.isTerminal) {
      throw new BadRequestException(
        `Dispute ${disputeId} is ${dispute.status} and no longer accepts evidence`,
      );
    }
    if (!input.cid?.trim()) {
      throw new BadRequestException('An evidence CID is required');
    }
    this.assertWindowOpen(dispute);

    return this.applyEvidence(this.dataSource.manager, dispute, {
      submitterWallet: input.submitterWallet,
      cid: input.cid,
      description: input.description,
      kind: dispute.raiserWallet !== input.submitterWallet ? 'COUNTER' : 'CLAIM',
    });
  }

  // ─── Escalation ──────────────────────────────────────────────────────────

  /**
   * Move an OPEN dispute to VOTING once enough value is staked.
   *
   * No-op once escalated, so it is safe to call after any stake change.
   */
  async maybeEscalate(disputeId: string): Promise<Dispute | null> {
    const dispute = await this.findById(disputeId);
    if (dispute.status !== 'OPEN') return null;

    const cfg = this.getConfig();
    const total = this.toUnits(
      await this.recomputeTotalBond(this.stakes, disputeId),
    );
    const threshold = this.toUnits(cfg.stakeThreshold);
    if (total < threshold) return null;

    const now = new Date();
    dispute.status = 'VOTING';
    dispute.totalBond = this.toDecimal(total);
    dispute.votingStartedAt = now;
    dispute.voteDeadlineAt = new Date(
      now.getTime() + cfg.voteDurationHours * 60 * 60 * 1_000,
    );
    // Snapshot the quorum so a later config change cannot retroactively
    // invalidate a vote already in progress.
    dispute.governanceQuorum = cfg.governanceQuorum;
    await this.disputes.save(dispute);

    const call = await this.calls.findOne({ where: { id: dispute.callId } });
    if (call) {
      call.status = 'DISPUTED';
      call.statusUpdatedAt = now;
      await this.calls.save(call);
    }

    await this.auditLog.append({
      callId: String(dispute.callId),
      action: AuditLogAction.DISPUTE_ESCALATED,
      actor: 'system',
      payloadHash: JSON.stringify({
        disputeId,
        totalBond: dispute.totalBond,
        threshold: cfg.stakeThreshold,
        quorum: cfg.governanceQuorum,
        voteDeadlineAt: dispute.voteDeadlineAt?.toISOString(),
      }),
    });

    this.logger.warn(
      `Dispute ${disputeId} escalated to governance: ${dispute.totalBond} staked ` +
        `(threshold ${cfg.stakeThreshold}), quorum ${cfg.governanceQuorum}`,
    );
    this.eventEmitter.emit('dispute.escalated', {
      disputeId,
      callId: String(dispute.callId),
      totalBond: dispute.totalBond,
      quorum: cfg.governanceQuorum,
      voteDeadlineAt: dispute.voteDeadlineAt?.toISOString(),
    });

    return this.findById(disputeId);
  }

  // ─── Governance voting ───────────────────────────────────────────────────

  /** Record one governance signer's vote, deciding the dispute at quorum. */
  async recordVote(
    disputeId: string,
    input: RecordVoteInput,
  ): Promise<Dispute> {
    const dispute = await this.findById(disputeId);
    if (dispute.status !== 'VOTING') {
      throw new BadRequestException(
        `Dispute ${disputeId} is ${dispute.status}; only a VOTING dispute ` +
          'accepts governance votes',
      );
    }
    if (dispute.voteDeadlineAt && new Date() > dispute.voteDeadlineAt) {
      throw new BadRequestException(
        `The voting deadline for dispute ${disputeId} passed at ` +
          `${dispute.voteDeadlineAt.toISOString()}`,
      );
    }
    if (!this.isGovernanceSigner(input.signerWallet)) {
      throw new ForbiddenException(
        `${input.signerWallet} is not a configured governance signer`,
      );
    }

    const existing = await this.approvals.findOne({
      where: { disputeId, signerWallet: input.signerWallet },
    });
    if (existing) {
      throw new BadRequestException(
        `${input.signerWallet} has already voted on this dispute`,
      );
    }

    await this.approvals.save(
      this.approvals.create({
        disputeId,
        signerWallet: input.signerWallet,
        decision: input.decision,
        note: input.note ?? null,
      }),
    );

    return this.tallyVotes(disputeId);
  }

  /**
   * Count votes and finalise the dispute once quorum is reached.
   *
   * A quorum must be reached *for one decision*. A vote split across both
   * outcomes is not a decision, however many total votes there are — otherwise
   * two signers voting OVERTURN and one voting CONFIRM would overturn on a
   * quorum of three, which is not what "quorum" means.
   */
  async tallyVotes(disputeId: string): Promise<Dispute> {
    const dispute = await this.findById(disputeId);
    if (dispute.status !== 'VOTING') return dispute;

    const votes = await this.approvals.find({ where: { disputeId } });
    const quorum = dispute.governanceQuorum ?? this.getConfig().governanceQuorum;

    const overturn = votes.filter((v) => v.decision === 'OVERTURN').length;
    const confirm = votes.filter((v) => v.decision === 'CONFIRM').length;

    if (overturn >= quorum) {
      return this.finalise(dispute, true, 'GOVERNANCE_QUORUM', {
        votes: votes.length,
        overturn,
        confirm,
      });
    }
    if (confirm >= quorum) {
      return this.finalise(dispute, false, 'GOVERNANCE_QUORUM', {
        votes: votes.length,
        overturn,
        confirm,
      });
    }
    return dispute;
  }

  private isGovernanceSigner(wallet: string): boolean {
    const signers = this.configService.get<string>('GOVERNANCE_SIGNERS', '');
    if (!signers.trim()) {
      // No multisig configured means no one can escalate past the oracle. That
      // is the safe direction: the dispute still expires to CONFIRMED.
      return false;
    }
    const normalised = wallet.toLowerCase();
    return signers
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .includes(normalised);
  }

  // ─── Finalisation ────────────────────────────────────────────────────────

  /**
   * Move a dispute to a terminal state and settle every stake.
   *
   * An overturn slashes the bonds; a confirmation returns them. The call status
   * follows the dispute, because a call whose resolution was overturned is no
   * longer a settled call.
   *
   * The three writes are one transaction for the same reason they are in
   * `raiseDispute`: the dispute going terminal is what makes the operation
   * non-retryable. If it committed and the stake settlement then failed, every
   * bond would sit at ACTIVE with no dispute left to settle it — money that is
   * neither returned nor slashed, and no sweep that will ever touch it again.
   */
  private async finalise(
    dispute: Dispute,
    upheld: boolean,
    reason: DisputeOutcomeReason,
    detail: Record<string, unknown>,
  ): Promise<Dispute> {
    const now = new Date();
    const stakeStatus: StakeStatus = upheld ? 'SLASHED' : 'RETURNED';

    const call = await this.dataSource.transaction(async (manager) => {
      const disputeRepo = manager.getRepository(Dispute);
      const stakeRepo = manager.getRepository(DisputeStake);
      const callRepo = manager.getRepository(Call);

      // Re-assert under the transaction: two paths (a governance tally and the
      // expiry sweeper, say) can reach the same dispute at once, and only one
      // of them may run the settlement.
      const locked = await disputeRepo.findOne({
        where: { id: dispute.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) {
        throw new NotFoundException(`Dispute ${dispute.id} not found`);
      }
      if (locked.isTerminal) return null;

      locked.status = upheld ? 'OVERTURNED' : 'CONFIRMED';
      locked.upheld = upheld;
      locked.decidedAt = now;
      locked.resolvedBy = (detail.signerWallet as string) ?? null;
      await disputeRepo.save(locked);

      await stakeRepo.update(
        { disputeId: locked.id, status: 'ACTIVE' },
        { status: stakeStatus, settledAt: now },
      );

      const found = await callRepo.findOne({ where: { id: locked.callId } });
      if (found) {
        found.status = upheld ? 'OVERTURNED' : 'SETTLED';
        found.activeDisputeId = null;
        found.statusUpdatedAt = now;
        await callRepo.save(found);
      }
      return found;
    });

    if (call === null) {
      this.logger.warn(
        `Dispute ${dispute.id} was already finalised; skipping duplicate settlement`,
      );
      return this.findById(dispute.id);
    }

    // Audit and events go out only after the writes have committed.
    if (call) {
      await this.auditLog.append({
        callId: String(call.id),
        action: upheld
          ? AuditLogAction.DISPUTE_OVERTURNED
          : AuditLogAction.DISPUTE_CONFIRMED,
        actor: (detail.signerWallet as string) ?? 'system',
        payloadHash: JSON.stringify({
          disputeId: dispute.id,
          reason,
          stakes: stakeStatus,
          ...detail,
        }),
      });

      // Hand-off to the on-chain settlement path. The dispute decision changes
      // what the contract must pay out, so the relayer needs the same payload
      // shape the oracle uses; emitting it here keeps that handoff in one place
      // rather than duplicating the decision logic on-chain.
      this.eventEmitter.emit('dispute.resolved', {
        marketId: String(call.callOnchainId ?? call.id),
        callId: String(call.id),
        disputeId: dispute.id,
        resolution: upheld ? 'upheld' : 'rejected',
        finalOutcomeCode: upheld ? (call.outcome ? 0 : 1) : call.outcome ? 1 : 0,
        resolvedAt: now.getTime(),
        reason,
      });
      this.eventEmitter.emit(
        upheld ? 'dispute.overturned' : 'dispute.confirmed',
        {
          callId: String(call.id),
          disputeId: dispute.id,
          totalBond: dispute.totalBond,
          reason,
        },
      );
    }

    this.logger.warn(
      `Dispute ${dispute.id} ${upheld ? 'OVERTURNED' : 'CONFIRMED'} (${reason}): ` +
        `call ${dispute.callId} is now ${call?.status ?? 'unchanged'}`,
    );
    return this.findById(dispute.id);
  }

  /**
   * Admin override: settle a dispute immediately, bypassing the vote.
   *
   * This exists for the case where governance cannot convene — signers
   * unreachable, quorum misconfigured — and a dispute is sitting open past its
   * deadline with real bonds locked up. It is an override, not a shortcut, so
   * it is audited under its own reason and still settles every stake, and it
   * still defaults to confirming the original resolution: passing
   * `upheld: true` has to be a deliberate act.
   */
  async adminResolve(
    disputeId: string,
    adminWallet: string,
    upheld: boolean,
    note?: string,
  ): Promise<Dispute> {
    const dispute = await this.findById(disputeId);
    if (dispute.isTerminal) {
      throw new BadRequestException(
        `Dispute ${disputeId} is already ${dispute.status}`,
      );
    }
    return this.finalise(dispute, upheld, 'ADMIN_DECISION', {
      signerWallet: adminWallet,
      note,
    });
  }

  // ─── Timers ──────────────────────────────────────────────────────────────

  /**
   * Close out disputes whose deadline has passed.
   *
   * Called on an interval and safe to call by hand: every transition is guarded
   * by the current status, so a second run is a no-op rather than a double
   * slashing.
   *
   * Both outcomes are CONFIRMED. An OPEN dispute that ran out of time never
   * reached the threshold that would justify overriding a settlement, and a
   * VOTING dispute that ran out of time never reached quorum. In both cases the
   * original resolution stands and the stakers get their bonds back.
   */
  async processExpiredWindows(now = new Date()): Promise<{
    windowExpired: Dispute[];
    voteTimedOut: Dispute[];
  }> {
    const windowExpired: Dispute[] = [];
    const voteTimedOut: Dispute[] = [];

    const openDisputes = await this.disputes.find({
      where: { status: 'OPEN', windowExpiresAt: LessThan(now) },
    });
    for (const dispute of openDisputes) {
      windowExpired.push(
        await this.finalise(dispute, false, 'WINDOW_EXPIRED', {}),
      );
    }

    const voting = await this.disputes.find({
      where: { status: 'VOTING', voteDeadlineAt: LessThan(now) },
    });
    for (const dispute of voting) {
      voteTimedOut.push(
        await this.finalise(dispute, false, 'VOTE_TIMEOUT', {}),
      );
    }

    if (windowExpired.length || voteTimedOut.length) {
      this.logger.warn(
        `Closed ${windowExpired.length} expired dispute window(s) and ` +
          `${voteTimedOut.length} timed-out vote(s)`,
      );
    }
    return { windowExpired, voteTimedOut };
  }

  /**
   * Drive the expiry sweep on a timer.
   *
   * Every minute is far more often than needed — the deadlines being watched
   * are measured in hours — but the sweep is a single indexed query per state
   * and a no-op when nothing is due, so a minute costs nothing and bounds how
   * long a window can stay open past its deadline.
   *
   * Errors are swallowed deliberately. A sweep that throws would leave stale
   * windows open indefinitely, and a dispute that never closes is worse than
   * one that closes a minute late.
   */
  @Interval('dispute-window-sweep', 60_000)
  async scheduledSweep(): Promise<void> {
    try {
      await this.processExpiredWindows();
    } catch (err) {
      this.logger.error(
        `Dispute window sweep failed: ${(err as Error).message}`,
      );
    }
  }

  // ─── Reads ───────────────────────────────────────────────────────────────
  async findById(id: string): Promise<Dispute> {
    const dispute = await this.disputes.findOne({
      where: { id },
      relations: ['call'],
    });
    if (!dispute) throw new NotFoundException(`Dispute ${id} not found`);
    return dispute;
  }

  /** The open or in-voting dispute for a call, if there is one. */
  async findActiveForCall(callId: number): Promise<Dispute | null> {
    return this.disputes.findOne({
      where: { callId, status: In(['OPEN', 'VOTING']) },
      order: { raisedAt: 'DESC' },
    });
  }

  async findByCall(callId: number): Promise<Dispute[]> {
    return this.disputes.find({
      where: { callId },
      order: { raisedAt: 'DESC' },
    });
  }

  async findByStatus(status: DisputeStatus): Promise<Dispute[]> {
    return this.disputes.find({ where: { status }, order: { raisedAt: 'DESC' } });
  }

  /** Full dispute record including stakes, evidence, and votes. */
  async findDetailed(
    id: string,
  ): Promise<
    Dispute & {
      stakes: DisputeStake[];
      evidence: DisputeEvidence[];
      approvals: DisputeApproval[];
    }
  > {
    const dispute = await this.findById(id);
    // Approvals are part of the record, not an implementation detail: a
    // staker deciding whether to back a dispute needs to see who has already
    // committed the multisig and how the vote stood.
    const [stakes, evidence, approvals] = await Promise.all([
      this.stakes.find({ where: { disputeId: id } }),
      this.evidence.find({ where: { disputeId: id } }),
      this.approvals.find({ where: { disputeId: id } }),
    ]);
    dispute.stakes = stakes;
    dispute.evidence = evidence;
    dispute.approvals = approvals;
    return dispute;
  }

  private assertOpen(dispute: Dispute, action: string): void {
    if (dispute.status !== 'OPEN') {
      throw new BadRequestException(
        `Dispute ${dispute.id} is ${dispute.status}; cannot ${action}`,
      );
    }
  }

  private assertWindowOpen(dispute: Dispute): void {
    if (new Date() > dispute.windowExpiresAt) {
      throw new BadRequestException(
        `The dispute window for ${dispute.id} closed at ` +
          `${dispute.windowExpiresAt.toISOString()}`,
      );
    }
  }
}
