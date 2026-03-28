import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FeedService } from './feed.service';

@Injectable()
export class TrendingAggregationJob {
  private readonly logger = new Logger(TrendingAggregationJob.name);

  constructor(private readonly feedService: FeedService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleCron(): Promise<void> {
    this.logger.log('Running trending feed aggregation cron');
    try {
      const top = await this.feedService.refreshTrendingCache();
      this.logger.log(
        `Trending feed cache refreshed (${top.length} calls computed)`,
      );
    } catch (error) {
      this.logger.error(`Failed to refresh trending feed cache: ${error}`);
    }
  }
}
