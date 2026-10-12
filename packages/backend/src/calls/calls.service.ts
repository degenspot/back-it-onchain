import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Call } from './call.entity';
import { Participant } from './participant.entity';
import { Dispute } from './dispute.entity';
import { IpfsService } from '../ipfs/ipfs.service';
import { AuditLogService } from '../oracle/audit-log.service';
import { AuditLogAction } from '../oracle/audit-log.entity';

type CallsListOptions = {
  chain?: 'base' | 'stellar';
  limit: number;
  offset: number;
};

type CallsListResponse = {
  data: Call[];
  meta: {
    total: number;
    limit: number;
    offset: number;
  };
};

type CallResponse = {
  data: Call;
  meta: null;
};

// ── Lifecycle helpers ─────────────────────────────────────────────────────────

/**
 * Valid call statuses in lifecycle order.
 *
 * The oracle and the dispute system both write statuses outside the original
 * #300 machine (`SETTLED`, `RESOLUTION_HALTED`, `DISPUTED`, `OVERTURNED`).
 * They have to be listed here or `updateStatus` rejects its own service's
 * writes as an illegal transition.
 */
export type CallStatus =
  | 'OPEN'
  | 'SETTLING'
  | 'SETTLED'
  | 'RESOLVED'
  | 'UNRESOLVED'
  | 'STALE'
  // BE-018: frozen because the price could not be trusted. Recoverable by an
  // admin unfreeze, which is the only way out — it must not re-enter SETTLING on
  // its own, or the guard that froze it would just freeze it again.
  | 'RESOLUTION_HALTED'
  // BE-019: a dispute is open or with governance. The call is still settled
  // underneath; this is a marker, not a replacement for the resolution.
  | 'DISPUTED'
  // BE-019: governance overturned the settlement.
  | 'OVERTURNED';

const ALLOWED_TRANSITIONS: Record<CallStatus, CallStatus[]> = {
  OPEN: ['SETTLING'],
  SETTLING: ['SETTLED', 'RESOLVED', 'UNRESOLVED', 'RESOLUTION_HALTED'],
  SETTLED: ['DISPUTED', 'OVERTURNED'],
  RESOLVED: [],
  UNRESOLVED: ['SETTLING'], // admin force-retry
  STALE: ['SETTLING'],      // admin force-unresolve path
  // Only an admin unfreeze moves a frozen call, and it goes back to OPEN so the
  // guard is re-evaluated from a clean slate rather than resuming mid-flight.
  RESOLUTION_HALTED: ['OPEN'],
  DISPUTED: ['SETTLED', 'OVERTURNED'],
  OVERTURNED: [],
};

function assertTransition(current: CallStatus, next: CallStatus): void {
  if (!(ALLOWED_TRANSITIONS[current] ?? []).includes(next)) {
    throw new BadRequestException(
      `Illegal status transition: ${current} → ${next}`,
    );
  }
}

// ── Payout types ─────────────────────────────────────────────────────────────

export interface ParticipantPayout {
  participantId: string;
  wallet: string;
  stake: number;
  position: boolean;
  payout: number;
  isWinner: boolean;
}

export interface PayoutsResult {
  callId: number;
  outcome: boolean | null;
  totalPool: number;
  feeBps: number;
  netPool: number;
  payouts: ParticipantPayout[];
}

const DEFAULT_FEE_BPS = 200; // 2%

@Injectable()
export class CallsService {
  constructor(
    @InjectRepository(Call)
    private callsRepository: Repository<Call>,
    @InjectRepository(Participant)
    private participantsRepository: Repository<Participant>,
    @InjectRepository(Dispute)
    private disputesRepository: Repository<Dispute>,
    private readonly ipfsService: IpfsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ── Standard CRUD ─────────────────────────────────────────────────────────

  async create(callData: Partial<Call>): Promise<Call> {
    const call = this.callsRepository.create(callData);
    return this.callsRepository.save(call);
  }

  async findAll(options: CallsListOptions): Promise<CallsListResponse> {
    const where: any = { isHidden: false };
    if (options.chain) {
      where.chain = options.chain;
    }

    const [data, total] = await this.callsRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      relations: ['creator'],
      take: options.limit,
      skip: options.offset,
    });

    return { data, meta: { total, limit: options.limit, offset: options.offset } };
  }

  async findOne(id: number): Promise<CallResponse> {
    const call = await this.callsRepository.findOne({
      where: { id },
      relations: ['creator'],
    });
    if (!call) throw new NotFoundException('Call not found');
    return { data: call, meta: null };
  }

  async report(
    id: number,
    reason: string,
    reporterWallet: string,
  ): Promise<{ success: boolean; message: string }> {
    const call = await this.callsRepository.findOne({ where: { id } });
    if (!call) throw new NotFoundException('Call not found');

    call.reportCount += 1;
    call.lastReporterWallet = reporterWallet;
    if (call.reportCount >= 5) call.isHidden = true;

    await this.callsRepository.save(call);
    return { success: true, message: 'Report submitted successfully' };
  }

  async uploadIpfs(data: any): Promise<{ cid: string }> {
    const buffer = Buffer.from(JSON.stringify(data));
    const cid = await this.ipfsService.pin(buffer, 'data.json');
    return { cid };
  }

  async getIpfs(cid: string): Promise<any> {
    const buffer = await this.ipfsService.fetch(cid);
    return JSON.parse(buffer.toString('utf-8'));
  }

  async getStakesByWallet(wallet: string): Promise<any[]> {
    const participants = await this.participantsRepository.find({
      where: { wallet },
      relations: ['call'],
    });

    const now = new Date();

    return participants.map((participant) => {
      const call = participant.call as Call;
      const isSettled = call.status === 'SETTLED' || call.outcome !== null;
      const hasEnded = new Date(call.endTs) <= now;

      let status: 'active' | 'settled' | 'claimable' = 'active';
      if (isSettled) {
        status = participant.position === call.outcome ? 'claimable' : 'settled';
      } else if (hasEnded) {
        status = 'settled';
      }

      const timeLeft = hasEnded ? 'Ended' : getTimeRemaining(call.endTs);
      const callTitle = call.conditionJson?.title || `Market #${call.id}`;

      let payout: number | undefined;
      if (status === 'claimable') {
        const totalStakeYes = call.totalStakeYes || 0;
        const totalStakeNo = call.totalStakeNo || 0;
        const totalPool = totalStakeYes + totalStakeNo;
        const userStake = participant.amount;
        if (totalPool > 0) {
          const userSidePool = participant.position ? totalStakeYes : totalStakeNo;
          const losingPool = participant.position ? totalStakeNo : totalStakeYes;
          payout = userStake + losingPool * (userStake / userSidePool);
        } else {
          payout = userStake;
        }
      }

      return {
        id: participant.id,
        callId: call.id,
        callTitle,
        choice: participant.position ? 'yes' : 'no',
        amount: participant.amount,
        chain: call.chain,
        timeLeft: status === 'active' ? timeLeft : undefined,
        status,
        payout,
        result: status === 'claimable' ? 'won' : status === 'settled' ? 'lost' : undefined,
      };
    });
  }

  // ── Issue #300: Call lifecycle state machine ───────────────────────────────

  /**
   * Idempotent status transition with guard on endTs and lifecycle rules.
   * Valid transitions: OPEN → SETTLING → RESOLVED | UNRESOLVED.
   * Admin-only force path: UNRESOLVED | STALE → SETTLING.
   */
  async updateStatus(
    id: number,
    next: CallStatus,
    opts: { outcome?: boolean; adminForce?: boolean } = {},
  ): Promise<Call> {
    const call = await this.callsRepository.findOne({ where: { id } });
    if (!call) throw new NotFoundException('Call not found');

    // Idempotent — already in target state
    if (call.status === next) return call;

    if (!opts.adminForce) {
      assertTransition(call.status as CallStatus, next);

      // Cannot enter SETTLING before endTs
      if (next === 'SETTLING' && new Date(call.endTs) > new Date()) {
        throw new BadRequestException('Call endTs has not passed yet');
      }
    }

    call.status = next;
    if (next === 'RESOLVED' && opts.outcome !== undefined) {
      call.outcome = opts.outcome;
    }

    const saved = await this.callsRepository.save(call);

    // Emit outcome.proposed when transitioning to SETTLING
    if (next === 'SETTLING') {
      this.eventEmitter.emit('outcome.proposed', {
        marketId: String(call.callOnchainId ?? call.id),
        callId: String(call.id),
        submitter: 'system',
        resultCode: 0,
        windowExpiresAt: Math.floor(Date.now() / 1000) + 3600,
        timestamp: Date.now(),
      });
    }

    return saved;
  }

  // ── Issue #301: Participant accounting & pull-payout engine ───────────────

  /**
   * Calculate proportional payouts for all participants of a settled call.
   * Formula: payout = stake + (stake / winnerPool) * loserPool * (1 - feeBps/10000)
   * Draw / UNRESOLVED → all participants receive their stake back.
   */
  async calculatePayouts(
    callId: number,
    feeBps = DEFAULT_FEE_BPS,
  ): Promise<PayoutsResult> {
    const call = await this.callsRepository.findOne({ where: { id: callId } });
    if (!call) throw new NotFoundException('Call not found');

    const participants = await this.participantsRepository.find({
      where: { callId: String(callId) },
    });

    const totalPool = participants.reduce((s, p) => s + Number(p.amount), 0);
    const feeAmount = (totalPool * feeBps) / 10000;
    const netPool = totalPool - feeAmount;

    // Draw or unresolved → refund everyone
    if (call.outcome === null || call.outcome === undefined || call.status === 'UNRESOLVED') {
      return {
        callId,
        outcome: call.outcome ?? null,
        totalPool,
        feeBps,
        netPool: totalPool, // no fee on refunds
        payouts: participants.map((p) => ({
          participantId: p.id,
          wallet: p.wallet,
          stake: Number(p.amount),
          position: p.position,
          payout: Number(p.amount),
          isWinner: false,
        })),
      };
    }

    const winningSide = call.outcome;
    const winners = participants.filter((p) => p.position === winningSide);
    const losers = participants.filter((p) => p.position !== winningSide);
    const winnerPool = winners.reduce((s, p) => s + Number(p.amount), 0);
    const loserPool = losers.reduce((s, p) => s + Number(p.amount), 0);
    const netLoserPool = loserPool * (1 - feeBps / 10000);

    const payouts: ParticipantPayout[] = [
      ...winners.map((p) => {
        const stake = Number(p.amount);
        const share = winnerPool > 0 ? (stake / winnerPool) * netLoserPool : 0;
        return {
          participantId: p.id,
          wallet: p.wallet,
          stake,
          position: p.position,
          payout: stake + share,
          isWinner: true,
        };
      }),
      ...losers.map((p) => ({
        participantId: p.id,
        wallet: p.wallet,
        stake: Number(p.amount),
        position: p.position,
        payout: 0,
        isWinner: false,
      })),
    ];

    return { callId, outcome: call.outcome, totalPool, feeBps, netPool, payouts };
  }

  // ── Frozen-call recovery (BE-018) ────────────────────────────────────────

  /**
   * Admin: unfreeze a call that the staleness guard froze.
   *
   * Returns the call to `OPEN` so the next resolution sweep picks it up. It is
   * deliberately *not* settled here: the operator's job is to decide the feed
   * is trustworthy again, and the oracle still has to fetch and evaluate a
   * price. Unfreezing therefore re-enters the ordinary path, including the
   * staleness check — if the feed is still bad, the call re-freezes itself
   * rather than settling on the same bad price. That is the intended
   * behaviour: an unfreeze is a claim that the *cause* is fixed, and the
   * oracle verifies the claim.
   */
  async unfreezeResolution(
    callId: number,
    adminWallet: string,
    note?: string,
  ): Promise<Call> {
    const call = await this.callsRepository.findOne({ where: { id: callId } });
    if (!call) throw new NotFoundException('Call not found');
    if (call.status !== 'RESOLUTION_HALTED') {
      throw new BadRequestException(
        `Call ${callId} is ${call.status}, not RESOLUTION_HALTED — nothing to unfreeze`,
      );
    }

    const previousReason = call.resolutionHaltedReason;
    call.status = 'OPEN';
    call.resolutionHaltedReason = null;
    call.statusUpdatedAt = new Date();
    const saved = await this.callsRepository.save(call);

    if (this.auditLogService) {
      await this.auditLogService.append({
        callId: String(callId),
        action: AuditLogAction.ORACLE_RESOLUTION_UNFROZEN,
        actor: adminWallet,
        payloadHash: JSON.stringify({ previousReason, note }),
      });
    }

    this.eventEmitter.emit('oracle.resolution_unfrozen', {
      callId: String(callId),
      marketId: String(call.callOnchainId ?? callId),
      adminWallet,
      previousReason,
    });

    return saved;
  }

  /**
   * Calls frozen by the staleness guard, most recent first.
   *
   * Exposed so an operator can see what needs attention instead of having to
   * know the status is filterable.
   */
  async findHaltedCalls(limit = 50): Promise<Call[]> {
    return this.callsRepository.find({
      where: { status: 'RESOLUTION_HALTED' },
      order: { statusUpdatedAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }
}

function getTimeRemaining(endTs: string | Date): string {
  try {
    const now = new Date();
    const end = new Date(endTs);
    const diff = Math.max(0, end.getTime() - now.getTime());
    if (diff === 0) return 'Ended';
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  } catch {
    return 'TBD';
  }
}
