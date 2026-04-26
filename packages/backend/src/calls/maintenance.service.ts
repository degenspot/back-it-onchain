import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Call } from './call.entity';

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    @InjectRepository(Call)
    private readonly callsRepository: Repository<Call>,
  ) {}

  @Cron('0 */6 * * *')
  async handleStaleCallsCleanup(): Promise<void> {
    this.logger.log('Running stale call detection...');

    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - 48);

    const staleCalls = await this.callsRepository.find({
      where: { status: 'OPEN', endTs: LessThan(cutoff) },
    });

    if (staleCalls.length === 0) {
      this.logger.log('No stale calls found.');
      return;
    }

    for (const call of staleCalls) {
      call.status = 'STALE';
      await this.callsRepository.save(call);
      this.logger.warn(
        `Call ${call.id} marked STALE — manual intervention required.`,
      );
    }

    this.logger.log(`Marked ${staleCalls.length} call(s) as STALE.`);
  }
}