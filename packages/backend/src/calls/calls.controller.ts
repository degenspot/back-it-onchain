import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  ServiceUnavailableException,
  ParseIntPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CallsService, CallStatus } from './calls.service';
import { Call } from './call.entity';
import { DisputeService } from './dispute.service';
import { AdminService } from '../admin/admin.service';
import { CallsQueryDto } from './dto/calls-query.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

/** Body for POST /calls/:id/dispute (BE-019). */
export class RaiseDisputeDto {
  /** The argument for disputing, in prose. */
  claim!: string;
  /** Bond staked, as a decimal string. Never a JSON number: 18-decimal values
   *  do not survive `JSON.parse` intact. */
  bondAmount!: string;
  /** IPFS CID of the full claim document. */
  claimCid?: string;
}

@Controller('calls')
export class CallsController {
  constructor(
    private readonly callsService: CallsService,
    private readonly adminService: AdminService,
    private readonly disputeService: DisputeService,
  ) {}

  @Throttle({ wallet: { limit: 10, ttl: 1 * 60000 } })
  @Post()
  create(@Body() createCallDto: Partial<Call>) {
    if (this.adminService.isPaused()) {
      throw new ServiceUnavailableException(
        'Protocol is paused. New call creation is disabled.',
      );
    }
    return this.callsService.create(createCallDto);
  }

  @Get()
  findAll(@Query() query: CallsQueryDto) {
    return this.callsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.callsService.findOne(+id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/report')
  report(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Request() req: any,
  ) {
    return this.callsService.report(+id, reason, req.user.wallet);
  }

  @Throttle({ default: { limit: 10, ttl: 1 * 60000 } })
  @Post('ipfs')
  uploadIpfs(@Body() body: any) {
    return this.callsService.uploadIpfs(body);
  }

  @Get('ipfs/:cid')
  getIpfs(@Param('cid') cid: string) {
    return this.callsService.getIpfs(cid);
  }

  // ── Issue #300: lifecycle transition ──────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: CallStatus,
    @Body('outcome') outcome: boolean | undefined,
    @Body('adminForce') adminForce: boolean | undefined,
  ) {
    return this.callsService.updateStatus(+id, status, { outcome, adminForce });
  }

  // ── Issue #301: payout aggregation ────────────────────────────────────────

  @Get(':id/payouts')
  getPayouts(
    @Param('id') id: string,
    @Query('feeBps', new ParseIntPipe({ optional: true })) feeBps?: number,
  ) {
    return this.callsService.calculatePayouts(+id, feeBps);
  }

  // ── Dispute endpoints (BE-019) ───────────────────────────────────────────

  /**
   * POST /calls/:id/dispute
   * Lodge a dispute against a settled call, or back one already open.
   *
   * Body: { claim: string, bondAmount: string, claimCid?: string }
   *
   * Throttled harder than ordinary writes: a dispute is a paid action, and the
   * rate limit is the cheapest thing standing between the endpoint and a
   * script that files a thousand of them.
   */
  @UseGuards(JwtAuthGuard)
  @Throttle({ wallet: { limit: 5, ttl: 60 * 60000 } })
  @Post(':id/dispute')
  raiseDispute(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: RaiseDisputeDto,
    @Request() req: any,
  ) {
    return this.disputeService.raiseDispute(id, {
      raiserWallet: req.user.wallet,
      claim: body.claim,
      bondAmount: body.bondAmount,
      claimCid: body.claimCid,
    });
  }

  @Get(':id/disputes')
  getDisputes(@Param('id', ParseIntPipe) id: number) {
    return this.disputeService.findByCall(id);
  }
}
