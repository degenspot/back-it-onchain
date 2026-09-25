import {
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
import { PaymasterPolicyService } from '../oracle/paymaster-policy.service';
import { PaymasterBudgetSnapshot } from '../oracle/paymaster-policy.service';
import { AuditLogService } from '../oracle/audit-log.service';
import { AuditLog } from '../oracle/audit-log.entity';
import { IndexerDlqService, DlqJobData } from '../stellar-indexer/services/indexer-dlq.service';

class CircuitBreakerDto {
  paused!: boolean;
}

class ResetBudgetDto {
  address?: string;
}

class DlqRetryWithPatchDto {
  patch?: Partial<DlqJobData>;
}

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly callsService: CallsService,
    private readonly paymasterPolicyService: PaymasterPolicyService,
    private readonly auditLogService: AuditLogService,
    private readonly dlqService: IndexerDlqService,
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
   * POST /admin/disputes/:id/resolve
   * Resolve an open dispute. Body: { upheld: boolean }
   */
  @Post('disputes/:id/resolve')
  resolveDispute(
    @Param('id') id: string,
    @Body('upheld') upheld: boolean,
    @Request() req: any,
  ) {
    const adminWallet: string = req.headers['x-admin-wallet'] ?? 'admin';
    return this.callsService.resolveDispute(id, adminWallet, Boolean(upheld));
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

  // ── DLQ ────────────────────────────────────────────────────────────────

  /**
   * GET /admin/indexer/dlq/list?state=failed&start=0&end=49
   * List jobs in the indexer dead-letter queue.
   */
  @Get('indexer/dlq/list')
  async listDlqJobs(
    @Query('state') state: string = 'failed',
    @Query('start') start: string = '0',
    @Query('end') end: string = '49',
  ) {
    const jobs = await this.dlqService.listJobs(
      state as any,
      parseInt(start, 10),
      parseInt(end, 10),
    );
    return jobs.map((j) => ({
      id: j.id,
      state,
      data: j.data,
      failedReason: j.failedReason,
      attemptsMade: j.attemptsMade,
      timestamp: j.timestamp,
    }));
  }

  /**
   * POST /admin/indexer/dlq/retry/:id
   * Re-drive a single failed job. Optionally pass { patch: {...} } in the
   * body to override fields on the job data before re-queuing.
   */
  @Post('indexer/dlq/retry/:id')
  @HttpCode(HttpStatus.OK)
  async retryDlqJob(
    @Param('id') id: string,
    @Body() body: DlqRetryWithPatchDto,
  ) {
    if (body?.patch && Object.keys(body.patch).length > 0) {
      return this.dlqService.retryJobWithData(id, body.patch);
    }
    return this.dlqService.retryJob(id);
  }
}
