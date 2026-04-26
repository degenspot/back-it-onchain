import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  NotFoundException,
  Query,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { UsersService, ExportFormat } from './users.service';
import { BadgesService } from '../badges/badges.service';
import { CallsService } from '../calls/calls.service';
import { UpdateUserSettingsDto } from './dto/update-user-settings.dto';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly badgesService: BadgesService,
    private readonly callsService: CallsService,
  ) {}

  /**
   * GET /users/me/export-history?format=csv&wallet=<address>
   *
   * Streams the authenticated user's full prediction history.
   *
   * Query params:
   *   wallet  - The user's wallet address (until JWT guard wires up `req.user`)
   *   format  - 'csv' (default) or 'json'
   *
   * CSV columns: Call ID, Title, Chain, Status, Position, Stake YES, Stake NO,
   *              Outcome, Final Price, PnL, Start, End, Created At
   *
   * The response is streamed directly — no in-memory buffering.
   */
  @Get('me/export-history')
  async exportHistory(
    @Query('wallet') wallet: string,
    @Query('format') format: string = 'csv',
    @Res() res: Response,
  ) {
    if (!wallet) {
      throw new BadRequestException('wallet query parameter is required');
    }

    const fmt = (format === 'json' ? 'json' : 'csv') as ExportFormat;
    const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const filename = `history-${wallet.slice(0, 8)}-${timestamp}.${fmt}`;

    if (fmt === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    } else {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    }
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Transfer-Encoding', 'chunked');

    const stream = await this.usersService.exportHistory(wallet, fmt);

    stream.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).json({ message: 'Export failed', error: err.message });
      } else {
        res.end();
      }
    });

    stream.pipe(res);
  }

  /**
   * GET /users/me/settings?wallet=<address>
   *
   * Returns the current user's preferences and settings.
   * Creates a default row on first access for pre-existing accounts.
   */
  @Get('me/settings')
  async getSettings(@Query('wallet') wallet: string) {
    if (!wallet) {
      throw new BadRequestException('wallet query parameter is required');
    }
    return this.usersService.getSettings(wallet);
  }

  /**
   * PATCH /users/me/settings?wallet=<address>
   *
   * Partially updates the user's settings (true PATCH — only supplied
   * fields are written; everything else is left unchanged).
   *
   * Send `emailAddress: null` to explicitly clear the stored email.
   */
  @Patch('me/settings')
  async updateSettings(
    @Query('wallet') wallet: string,
    @Body() dto: UpdateUserSettingsDto,
  ) {
    if (!wallet) {
      throw new BadRequestException('wallet query parameter is required');
    }
    return this.usersService.upsertSettings(wallet, dto);
  }

  @Get(':wallet')
  async getUser(@Param('wallet') wallet: string) {
    const user = await this.usersService.findByWallet(wallet);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const badges = await this.badgesService.getUserBadges(wallet);
    return { ...user, badges };
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

  @Get(':wallet/stakes')
  async getStakes(@Param('wallet') wallet: string) {
    return this.callsService.getStakesByWallet(wallet);
  }
}
