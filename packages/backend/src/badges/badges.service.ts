import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UserBadge } from './badge.entity';
import { BadgeKey } from './badge-definitions';

@Injectable()
export class BadgesService {
  private readonly logger = new Logger(BadgesService.name);

  constructor(
    @InjectRepository(UserBadge)
    private readonly userBadgeRepo: Repository<UserBadge>,
    private readonly dataSource: DataSource,
  ) {}

  async getUserBadges(wallet: string): Promise<UserBadge[]> {
    return this.userBadgeRepo.find({
      where: { wallet },
      order: { grantedAt: 'ASC' },
    });
  }

  /**
   * Evaluate all badge thresholds for a wallet and grant any newly earned ones.
   * Runs asynchronously — callers should not await if they want non-blocking behaviour.
   * All DB checks run in parallel; granting is idempotent via the unique constraint.
   */
  async checkAndGrantBadges(wallet: string): Promise<void> {
    try {
      const [callCount, winsCount, totalStake, followerCount] = await Promise.all([
        this.getCallCount(wallet),
        this.getWinsCount(wallet),
        this.getTotalStake(wallet),
        this.getFollowerCount(wallet),
      ]);

      const earned: BadgeKey[] = [];
      if (callCount >= 1) earned.push(BadgeKey.FIRST_CALL);
      if (winsCount >= 5) earned.push(BadgeKey.FIVE_WINS);
      if (winsCount >= 10) earned.push(BadgeKey.TEN_WINS);
      if (totalStake >= 1000) earned.push(BadgeKey.WHALE_STAKER);
      if (followerCount >= 10) earned.push(BadgeKey.SOCIAL_BUTTERFLY);

      await Promise.all(earned.map((badge) => this.grantIfNew(wallet, badge)));
    } catch (err) {
      this.logger.error(
        `Badge check failed for ${wallet}: ${(err as Error).message}`,
      );
    }
  }

  private async grantIfNew(wallet: string, badge: BadgeKey): Promise<void> {
    const existing = await this.userBadgeRepo.findOne({ where: { wallet, badge } });
    if (existing) return;

    await this.userBadgeRepo.save(this.userBadgeRepo.create({ wallet, badge }));
    this.logger.log(`Granted badge [${badge}] to ${wallet}`);
  }

  // ─── Threshold queries ───────────────────────────────────────────────────

  private async getCallCount(wallet: string): Promise<number> {
    const [row] = await this.dataSource.query<[{ cnt: string }]>(
      `SELECT COUNT(*)::int AS cnt FROM "call"
       WHERE creator_wallet = $1 AND is_hidden = false`,
      [wallet],
    );
    return parseInt(row.cnt, 10);
  }

  private async getWinsCount(wallet: string): Promise<number> {
    const [row] = await this.dataSource.query<[{ cnt: string }]>(
      `SELECT COUNT(*)::int AS cnt FROM "call"
       WHERE creator_wallet = $1 AND status = 'RESOLVED' AND outcome = true`,
      [wallet],
    );
    return parseInt(row.cnt, 10);
  }

  private async getTotalStake(wallet: string): Promise<number> {
    const [row] = await this.dataSource.query<[{ total: string }]>(
      `SELECT COALESCE(SUM(total_stake_yes + total_stake_no), 0) AS total
       FROM "call" WHERE creator_wallet = $1 AND is_hidden = false`,
      [wallet],
    );
    return parseFloat(row.total ?? '0');
  }

  private async getFollowerCount(wallet: string): Promise<number> {
    const [row] = await this.dataSource.query<[{ cnt: string }]>(
      `SELECT COUNT(*)::int AS cnt FROM user_follows
       WHERE following_wallet = $1`,
      [wallet],
    );
    return parseInt(row.cnt, 10);
  }
}
