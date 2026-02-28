import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ChainType } from '../users/user.entity';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
