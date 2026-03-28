import { Controller, Post, Get, Body, Query, BadRequestException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { ChainType } from '../users/user.entity';
import { VerifySignatureDto } from './dto/verify-signature.dto';
import { Public } from '../decorators/public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * GET /auth/nonce?address=<wallet>
   *
   * Issues a one-time cryptographic challenge for the given wallet address.
   * The client must sign the returned message and submit it to POST /auth/verify.
   */
  @Public()
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  @Get('nonce')
  getNonce(@Query('address') address: string) {
    if (!address) {
      throw new BadRequestException('address query parameter is required');
    }
    const nonce = this.authService.generateNonce(address);
    const message = this.authService.buildSignMessage(address, nonce);
    return { nonce, message };
  }

  /**
   * POST /auth/verify
   *
   * Accepts { address, signature, chain, referrerWallet? }.
   * Verifies the cryptographic signature against the stored nonce and,
   * on success, returns a signed JWT for use in Authorization headers.
   */
  @Public()
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  @Post('verify')
  async verify(@Body() dto: VerifySignatureDto) {
    const token = await this.authService.verifySignatureAndLogin(
      dto.address,
      dto.signature,
      dto.chain,
      dto.referrerWallet,
    );
    return { accessToken: token };
  }

  /**
   * POST /auth/login  (legacy — wallet-only, no signature required)
   *
   * Kept for backwards compatibility during the migration to signature auth.
   * @deprecated  Use GET /auth/nonce → POST /auth/verify instead.
   */
  @Public()
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  @Post('login')
  async login(
    @Body() body: { wallet: string; chain?: ChainType; referrerWallet?: string },
  ) {
    const user = await this.authService.validateUser(
      body.wallet,
      body.chain,
      body.referrerWallet,
    );
    return user;
  }
}
