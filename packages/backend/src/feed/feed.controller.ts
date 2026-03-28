import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { FeedService } from './feed.service';

@Controller('feed')
export class FeedController {
  constructor(private readonly feedService: FeedService) {}

  @Get('following')
  async getFollowing(
    @Query('wallet') wallet: string,
    @Query('limit') limit: number = 20,
    @Query('offset') offset: number = 0,
  ) {
    if (!wallet) {
      throw new BadRequestException('Wallet address is required');
    }
    return this.feedService.getFollowingFeed(wallet, limit, offset);
  }

  @Get('for-you')
  async getForYou(
    @Query('limit') limit: number = 20,
    @Query('offset') offset: number = 0,
  ) {
    return this.feedService.getForYouFeed(limit, offset);
  }

  @Get('trending')
  async getTrending(
    @Query('limit') limit: number = 20,
    @Query('offset') offset: number = 0,
  ) {
    return this.feedService.getTrendingFeed(limit, offset);
  }
}
