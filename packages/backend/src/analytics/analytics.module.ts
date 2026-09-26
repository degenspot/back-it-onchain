import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { MetricsController, MetricsService } from './metrics.service';

@Module({
  controllers: [AnalyticsController, MetricsController],
  providers: [AnalyticsService, MetricsService],
  exports: [MetricsService],
})
export class AnalyticsModule {}
