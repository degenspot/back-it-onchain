/**
 * dispute.controller.ts  (BE-019)
 *
 * Dispute-scoped routes. Dispute *raising* lives under `/calls/:id/dispute`
 * because it is an action on a call; everything that operates on an existing
 * dispute lives here.
 *
 * Governance voting is behind the admin guard rather than the user guard,
 * because a vote is only meaningful from a configured multisig signer, and the
 * service re-checks the signer list. Two gates, deliberately: the guard stops
 * the request, the service check stops a misconfigured deployment from
 * accepting a vote it should reject.
 */

import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DisputeService } from './dispute.service';
import { DisputeStatus } from './dispute.entity';
import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

export class AddStakeDto {
  /** Bond amount as a decimal string, not a JSON number. */
  amount!: string;
}

export class AddEvidenceDto {
  /** IPFS CID of the evidence document. */
  cid!: string;
  description?: string;
}

export class CastVoteDto {
  decision!: 'OVERTURN' | 'CONFIRM';
  note?: string;
}

@Controller('disputes')
export class DisputeController {
  constructor(private readonly disputeService: DisputeService) {}

  /**
   * GET /disputes/config
   * The bond, threshold, and quorum currently in force, so a client can show
   * the user what filing a dispute will cost before they commit to it.
   */
  @Get('config')
  getConfig() {
    return this.disputeService.getConfig();
  }

  @Get()
  list(@Query('status') status?: DisputeStatus) {
    return status
      ? this.disputeService.findByStatus(status)
      : this.disputeService.findByStatus('VOTING');
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.disputeService.findDetailed(id);
  }

  /**
   * POST /disputes/:id/stake
   * Back an open dispute. Escalates it to governance if this crosses the
   * threshold.
   */
  @UseGuards(JwtAuthGuard)
  @Throttle({ wallet: { limit: 10, ttl: 60 * 60000 } })
  @Post(':id/stake')
  addStake(
    @Param('id') id: string,
    @Body() body: AddStakeDto,
    @Request() req: any,
  ) {
    return this.disputeService.addStake(id, {
      stakerWallet: req.user.wallet,
      amount: body.amount,
    });
  }

  /**
   * POST /disputes/:id/evidence
   * Attach counter-evidence.
   *
   * Open to any authenticated wallet, not only stakers: the outcome is decided
   * by stake and governance, and charging a bond to argue would just let the
   * richer side bury the other's evidence.
   */
  @UseGuards(JwtAuthGuard)
  @Throttle({ wallet: { limit: 20, ttl: 60 * 60000 } })
  @Post(':id/evidence')
  addEvidence(
    @Param('id') id: string,
    @Body() body: AddEvidenceDto,
    @Request() req: any,
  ) {
    return this.disputeService.attachEvidence(id, {
      submitterWallet: req.user.wallet,
      cid: body.cid,
      description: body.description,
    });
  }

  /**
   * POST /disputes/:id/vote
   * Cast a governance signer's vote. The dispute is finalised as soon as one
   * decision reaches quorum.
   */
  @UseGuards(AdminGuard)
  @Post(':id/vote')
  vote(
    @Param('id') id: string,
    @Body() body: CastVoteDto,
    @Request() req: any,
  ) {
    const signerWallet: string = req.headers['x-admin-wallet'] ?? 'admin';
    return this.disputeService.recordVote(id, {
      signerWallet,
      decision: body.decision,
      note: body.note,
    });
  }
}
