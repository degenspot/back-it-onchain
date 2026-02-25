import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { FollowService } from './follow.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('users')
export class FollowController {
  constructor(private readonly followService: FollowService) {}

  @Post(':address/follow')
  @UseGuards(JwtAuthGuard)
  async followUser(
    @Param('address') targetAddress: string,
    @Request() req: any,
  ) {
    return this.followService.followUser(req.user.address, targetAddress);
  }

  @Post(':address/unfollow')
  @UseGuards(JwtAuthGuard)
  async unfollowUser(
    @Param('address') targetAddress: string,
    @Request() req: any,
  ) {
    return this.followService.unfollowUser(req.user.address, targetAddress);
  }

  @Get(':address/followers')
  async getFollowers(
    @Param('address') address: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.followService.getFollowers(address, +page, +limit);
  }

  @Get(':address/following')
  async getFollowing(
    @Param('address') address: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.followService.getFollowing(address, +page, +limit);
  }

  @Get(':address/follow-stats')
  async getFollowStats(@Param('address') address: string) {
    return this.followService.getFollowStats(address);
  }

  @Get(':address/is-following')
  @UseGuards(JwtAuthGuard)
  async isFollowing(
    @Param('address') targetAddress: string,
    @Request() req: any,
  ) {
    return this.followService.isFollowing(req.user.address, targetAddress);
  }
}
