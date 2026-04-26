import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from './notifications.service';

@Injectable()
export class NotificationsCleanupService {
  private readonly logger = new Logger(NotificationsCleanupService.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly configService: ConfigService,
  ) {}

  @Cron('0 3 * * *')
  async handleNotificationCleanup(): Promise<void> {
    const retentionDays = this.configService.get<number>(
      'NOTIFICATION_RETENTION_DAYS',
      30,
    );

    this.logger.log(
      `Running notification cleanup (retention: ${retentionDays} days)...`,
    );

    await this.notificationsService.deleteOldNotifications(retentionDays);

    this.logger.log('Notification cleanup complete.');
  }
}