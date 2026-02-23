import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Leaderboard, LeaderboardPeriod } from './entities/leaderboard.entity';

@Injectable()
export class LeaderboardService {
  constructor(
    @InjectRepository(Leaderboard)
    private readonly leaderboardRepo: Repository<Leaderboard>,
  ) {}

  async getLeaderboard(period: LeaderboardPeriod, limit = 50) {
    return this.leaderboardRepo.find({
      where: { period },
      order: { rank: 'ASC' },
      take: limit,
    });
  }
}
