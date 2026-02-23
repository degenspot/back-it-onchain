import { Leaderboard } from './entities/leaderboard.entity';
import { LeaderboardController } from './leaderboard.controller';
import { LeaderboardService } from './leaderboard.service';

@Module({
  imports: [TypeOrmModule.forFeature([Leaderboard]), ScheduleModule.forRoot()],
  controllers: [LeaderboardController],
  providers: [LeaderboardService, LeaderboardAggregationJob],
})
export class LeaderboardModule {}
