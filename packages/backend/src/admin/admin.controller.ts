import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdminService } from './admin.service';
import { CallsService } from '../calls/calls.service';
import { DisputeService } from '../calls/dispute.service';
import { Call } from '../calls/call.entity';
import { PaymasterPolicyService } from '../oracle/paymaster-policy.service';
import { PaymasterBudgetSnapshot } from '../oracle/paymaster-policy.service';
import { AuditLogService } from '../oracle/audit-log.service';
import { AuditLog } from '../oracle/audit-log.entity';

class CircuitBreakerDto {
  paused!: boolean;
}

class ResetBudgetDto {
  address?: string;
}

class UnfreezeResolutionDto {
  /** Free-text record of why the freeze is being lifted. */
  note?: string;
}

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly callsService: CallsService,
    private readonly disputeService: DisputeService,
    private readonly paymasterPolicyService: PaymasterPolicyService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * PATCH /admin/circuit-breaker
   * Toggle the protocol-wide circuit breaker.
   */
  @Patch('circuit-breaker')
  @HttpCode(HttpStatus.OK)
  async setCircuitBreaker(
    @Body() body: CircuitBreakerDto,
  ): Promise<{ isPaused: boolean; updatedAt: Date }> {
    return this.adminService.setCircuitBreaker(Boolean(body.paused));
  }

  /**
   * GET /admin/calls/halted
   * Calls frozen by the price-staleness guard, most recently frozen first.
   */
  @Get('calls/halted')
  async listHaltedCalls(
    @Query('limit') limit?: string,
  ): Promise<Call[]> {
    const parsed = Number.parseInt(limit ?? '50', 10);
    return this.callsService.findHaltedCalls(
      Number.isFinite(parsed) ? parsed : 50,
    );
  }

  /**
   * POST /admin/calls/:id/unfreeze-resolution
   * Return a call frozen by the staleness guard to the resolution queue.
   *
   * Body: { note?: string }
   *
   * The call goes back to OPEN and is re-resolved by the next sweep, which
   * re-runs the staleness check. If the feed is still stale the call re-freezes
   * itself, so this endpoint cannot be used to force a settlement.
   */
  @Post('calls/:id/unfreeze-resolution')
  @HttpCode(HttpStatus.OK)
  async unfreezeResolution(
    @Param('id') id: string,
    @Body() body: UnfreezeResolutionDto,
    @Request() req: any,
  ): Promise<Call> {
    const callId = Number.parseInt(id, 10);
    if (!Number.isFinite(callId)) {
      throw new BadRequestException('Call id must be a number');
    }
    const adminWallet: string = req.headers['x-admin-wallet'] ?? 'admin';
    return this.callsService.unfreezeResolution(
      callId,
      adminWallet,
      body?.note,
    );
  }

  /**
   * POST /admin/disputes/:id/resolve
   * Settle a dispute by admin override, bypassing the governance vote.
   * Body: { upheld: boolean, note?: string }
   */
  @Post('disputes/:id/resolve')
  resolveDispute(
    @Param('id') id: string,
    @Body() body: { upheld: boolean; note?: string },
    @Request() req: any,
  ) {
    const adminWallet: string = req.headers['x-admin-wallet'] ?? 'admin';
    return this.disputeService.adminResolve(
      id,
      adminWallet,
      Boolean(body?.upheld),
      body?.note,
    );
  }

  /**
   * GET /admin/paymaster/budget
   *
   * Returns the paymaster budget snapshot: per-address caps, global daily
   * allowance, and current per-address spend/disabled state.
   */
  @Get('paymaster/budget')
  async getPaymasterBudget(): Promise<PaymasterBudgetSnapshot> {
    return this.paymasterPolicyService.getBudgetSnapshot();
  }

  /**
   * POST /admin/paymaster/budget/reset
   *
   * Reset the paymaster spend counters. Pass an `address` in the body to reset
   * a single address; omit it to reset the entire paymaster budget (re-enabling
   * all auto-disabled addresses).
   *
   * Body: { "address"?: string }
   */
  @Post('paymaster/budget/reset')
  @HttpCode(HttpStatus.OK)
  async resetPaymasterBudget(
    @Body() body: ResetBudgetDto,
  ): Promise<{ resets: string }> {
    await this.paymasterPolicyService.resetBudget(body.address);
    return { resets: body.address ?? 'all' };
  }

  /**
   * GET /admin/audit?callId=<optional>
   * Returns immutable audit log entries, optionally filtered by callId.
   */
  @Get('audit')
  async getAuditLogs(
    @Query('callId') callId?: string,
  ): Promise<AuditLog[]> {
    return this.auditLogService.query(callId);
  }
}
