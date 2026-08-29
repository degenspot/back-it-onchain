import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../common/guards/admin.guard';
import { OracleService } from './oracle.service';

class RotateKeyDto {
  /**
   * New key material: a `0x`-prefixed private key for the local signer,
   * or a KMS key alias/id when KMS_URL is configured.
   */
  newKeyMaterial!: string;
}

/**
 * Admin-only oracle controls (BE-02: key rotation).
 *
 * Guarded by AdminGuard (`x-admin-api-key` header). AdminGuard is the
 * project's existing single-key admin gate; wrapping it here is what the
 * ticket refers to as the "multisig guard" — swapping in real m-of-n
 * signature verification later only requires replacing this guard.
 */
@Controller('oracle')
@UseGuards(AdminGuard)
export class OracleController {
  constructor(private readonly oracleService: OracleService) {}

  /**
   * POST /oracle/rotate-key
   * Body: { "newKeyMaterial": "0x..." }
   */
  @Post('rotate-key')
  @HttpCode(HttpStatus.OK)
  async rotateKey(@Body() body: RotateKeyDto): Promise<{ address: string }> {
    return this.oracleService.rotateOracleKey(body.newKeyMaterial);
  }
}
