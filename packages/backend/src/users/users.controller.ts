import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':wallet')
  async getUser(@Param('wallet') wallet: string) {
    const user = await this.usersService.findByWallet(wallet);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  @Patch(':wallet')
  async updateProfile(
    @Param('wallet') wallet: string,
    @Body()
    body: {
      handle?: string;
      bio?: string;
      displayName?: string;
      avatarCid?: string;
    },
  ) {
    return this.usersService.updateProfile(wallet, body);
  }

  @Post(':wallet/follow')
  async follow(
    @Param('wallet') wallet: string,
    @Body() body: { targetWallet: string },
  ) {
    return this.usersService.follow(wallet, body.targetWallet);
  }

  @Post(':wallet/unfollow')
  async unfollow(
    @Param('wallet') wallet: string,
    @Body() body: { targetWallet: string },
  ) {
    return this.usersService.unfollow(wallet, body.targetWallet);
  }

  @Get(':wallet/social')
  async getSocialStats(@Param('wallet') wallet: string) {
    return this.usersService.getSocialStats(wallet);
  }

  @Get(':wallet/referrals')
  async getReferralStats(@Param('wallet') wallet: string) {
    return this.usersService.getReferralStats(wallet);
  }

  @Get(':wallet/is-following/:targetWallet')
  async isFollowing(
    @Param('wallet') wallet: string,
    @Param('targetWallet') targetWallet: string,
  ) {
    const isFollowing = await this.usersService.isFollowing(
      wallet,
      targetWallet,
    );
    return { isFollowing };
  }
}
