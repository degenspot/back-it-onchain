import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, In } from 'typeorm';
import { Call } from './call.entity';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CallsCleanupService {
  private readonly logger = new Logger(CallsCleanupService.name);

  constructor(
    @InjectRepository(Call)
    private readonly callsRepository: Repository<Call>,
    private readonly configService: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleAbandonedCallsCleanup() {
    this.logger.log('Starting abandoned calls cleanup cron job...');

    const thresholdDate = new Date();
    thresholdDate.setHours(thresholdDate.getHours() - 48);

    const staleCalls = await this.callsRepository.find({
      where: {
        status: In(['OPEN', 'SETTLING']),
        endTs: LessThan(thresholdDate),
      },
    });

    if (staleCalls.length === 0) {
      this.logger.log('No abandoned calls found.');
      return;
    }

    this.logger.log(`Found ${staleCalls.length} abandoned calls. Marking as UNRESOLVED.`);

    for (const call of staleCalls) {
      call.status = 'UNRESOLVED';
      await this.callsRepository.save(call);
      
      await this.notifyAdmin(call);
    }

    this.logger.log('Abandoned calls cleanup completed.');
  }

  private async notifyAdmin(call: Call) {
    const discordWebhookUrl = this.configService.get<string>('DISCORD_ADMIN_WEBHOOK_URL');
    const message = `🚨 **Manual Intervention Required** 🚨\nCall ID: ${call.id} (Title: ${call.title || 'N/A'}) has been marked as **UNRESOLVED** due to inactivity past its end time (${call.endTs}).`;

    if (discordWebhookUrl) {
      try {
        await fetch(discordWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: message }),
        });
      } catch (error) {
        this.logger.error(`Failed to send Discord notification for call ${call.id}: ${error.message}`);
      }
    } else {
      this.logger.warn(`No Discord webhook URL configured. Manual intervention required for call ${call.id}.`);
      this.logger.warn(message);
    }
  }
}
