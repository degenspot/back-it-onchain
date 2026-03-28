import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeedService } from './feed.service';
import { FeedController } from './feed.controller';
import { TrendingAggregationJob } from './trending-aggregation.job';
import { Call } from '../calls/call.entity';
import { UserFollows } from '../users/user-follows.entity';
import { StakeActivity } from '../calls/stake-activity.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Call, UserFollows, StakeActivity])],
  providers: [FeedService, TrendingAggregationJob],
  controllers: [FeedController],
})
export class FeedModule {}
