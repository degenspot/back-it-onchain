import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Optional,
  Param,
  Query,
} from '@nestjs/common';
import { AuditLogService, VerifiedResolutionEvidence } from './audit-log.service';
import { IpfsService, PinningStatus } from '../ipfs/ipfs.service';

/** The public shape of `GET /oracle/audit/:callId`. */
export type OracleAuditResponse = VerifiedResolutionEvidence & {
  /**
   * Live pinning check (BE-016 "validate IPFS pinning status with fallback
   * gateways"). Omitted when no `IpfsService` is wired or when the caller
   * passes `?verifyPinning=false`.
   */
  pinning?: PinningStatus;
};

/**
 * Public verification surface for oracle settlements (BE-016).
 *
 * Deliberately a separate controller from `OracleController`: that one is
 * admin-only (`AdminGuard`), and the whole point of an audit trail is that a
 * third party who never held a key can check it. Every value the endpoint
 * returns is either stored verbatim or derived from stored bytes, and the
 * proof is reported per-check so a reader can see *which* part failed.
 */
@Controller('oracle/audit')
export class OracleAuditController {
  constructor(
    private readonly auditLogService: AuditLogService,
    @Optional() private readonly ipfsService?: IpfsService,
  ) {}

  /**
   * GET /oracle/audit/:callId
   *
   * Returns the sealed resolution evidence for a settled call together with
   * the IPFS gateway URLs it can be fetched from and the verification result.
   *
   * Query:
   *   verifyPinning=false  skip the live IPFS pin/gateway probe (default: on)
   */
  @Get(':callId')
  async getAudit(
    @Param('callId') callId: string,
    @Query('verifyPinning') verifyPinning?: string,
  ): Promise<OracleAuditResponse> {
    if (!/^\d+$/.test(callId)) {
      throw new BadRequestException('callId must be a numeric call id');
    }

    const record = await this.auditLogService.getResolutionEvidence(callId);
    if (!record) {
      throw new NotFoundException(`No archived oracle resolution evidence for call ${callId}`);
    }

    if (verifyPinning === 'false' || !record.ipfs.cid || !this.ipfsService) {
      return { ...record };
    }

    let pinning: PinningStatus | undefined;
    try {
      pinning = await this.ipfsService.validatePinning(record.ipfs.cid);
    } catch (err) {
      // A pin check is evidence, not a precondition: an unreachable gateway
      // must not turn a verifiable record into a 5xx.
      pinning = undefined;
      void err;
    }

    return { ...record, pinning };
  }
}
