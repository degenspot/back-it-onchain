import { Controller, Get, Query } from '@nestjs/common';
import { LeaderboardService } from './leaderboard.service';
import { LeaderboardQueryDto } from './dto/leaderboard-query.dto';

@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get()
  async getLeaderboard(@Query() query: LeaderboardQueryDto) {
    const { period, limit } = query;

    const data = await this.leaderboardService.getLeaderboard(
      period,
      limit || 50,
    );

    return data.map((entry) => ({
      rank: entry.rank,
      userId: entry.userId,
      winRate: Number(entry.winRate.toFixed(2)),
      profit: entry.profit,
      activity: entry.totalPredictions,
    }));
  }
}
