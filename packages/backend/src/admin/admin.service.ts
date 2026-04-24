import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformSettings } from '../indexer/platform-settings.entity';

@Injectable()
export class AdminService implements OnModuleInit {
  private readonly logger = new Logger(AdminService.name);

  /** In-memory cache so callers pay zero DB cost on the hot path. */
  private cachedIsPaused = false;

  constructor(
    @InjectRepository(PlatformSettings)
    private readonly settingsRepo: Repository<PlatformSettings>,
  ) {}

  async onModuleInit(): Promise<void> {
    const settings = await this.getOrCreateSettings();
    this.cachedIsPaused = settings.isPaused;
    this.logger.log(
      `Circuit breaker initialised — protocol is ${this.cachedIsPaused ? 'PAUSED' : 'running'}`,
    );
  }

  /** Returns the cached pause state.  O(1) and safe to call in guards. */
  isPaused(): boolean {
    return this.cachedIsPaused;
  }

  /** Toggle the circuit breaker and persist the new state. */
  async setCircuitBreaker(paused: boolean): Promise<{ isPaused: boolean; updatedAt: Date }> {
    const settings = await this.getOrCreateSettings();
    settings.isPaused = paused;
    const saved = await this.settingsRepo.save(settings);
    this.cachedIsPaused = paused;
    this.logger.warn(`Circuit breaker set to isPaused=${paused}`);
    return { isPaused: saved.isPaused, updatedAt: saved.updatedAt };
  }

  private async getOrCreateSettings(): Promise<PlatformSettings> {
    let settings = await this.settingsRepo.findOne({ where: { id: 1 } });
    if (!settings) {
      settings = this.settingsRepo.create({ id: 1, feePercent: 0, isPaused: false });
      settings = await this.settingsRepo.save(settings);
    }
    return settings;
  }
}
