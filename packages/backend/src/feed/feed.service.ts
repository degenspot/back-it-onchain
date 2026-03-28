import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { Call } from '../calls/call.entity';
import { StakeActivity } from '../calls/stake-activity.entity';
import { UserFollows } from '../users/user-follows.entity';

export interface TrendingCall extends Call {
  trendingScore: number;
  isHot: boolean;
  volume24h: number;
  participantCount24h: number;
}

@Injectable()
export class FeedService {
  private readonly logger = new Logger(FeedService.name);
  private readonly TRENDING_CACHE_KEY = 'feed:trending:24h';

  constructor(
    @InjectRepository(Call)
    private callRepository: Repository<Call>,
    @InjectRepository(UserFollows)
    private userFollowsRepository: Repository<UserFollows>,
    @InjectRepository(StakeActivity)
    private stakeActivityRepository: Repository<StakeActivity>,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
  ) {}

  async getFollowingFeed(
    wallet: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<Call[]> {
    // 1. Get list of wallets the user follows
    const follows = await this.userFollowsRepository.find({
      where: { followerWallet: wallet },
      select: ['followingWallet'],
    });

    const followingWallets = follows.map((f) => f.followingWallet);

    if (followingWallets.length === 0) {
      return [];
    }

    // 2. Get calls from these wallets
    return this.callRepository.find({
      where: { creatorWallet: In(followingWallets), isHidden: false },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
      relations: ['creator'],
    });
  }

  async getForYouFeed(limit: number = 20, offset: number = 0): Promise<Call[]> {
    // Simple algorithm: Sort by total stake (popularity) and recency
    // For MVP, we'll just fetch recent calls.
    // Ideally, we'd have a computed column or view for "score".
    // Let's do a raw query to sort by total stake for now, or just standard find with order.

    // Using query builder to sort by calculated total stake
    return this.callRepository
      .createQueryBuilder('call')
      .leftJoinAndSelect('call.creator', 'creator')
      .where('call.isHidden = :isHidden', { isHidden: false })
      .addSelect('(call.totalStakeYes + call.totalStakeNo)', 'total_stake')
      .orderBy('total_stake', 'DESC')
      .addOrderBy('call.createdAt', 'DESC')
      .take(limit)
      .skip(offset)
      .getMany();
  }

  async getTrendingFeed(
    limit: number = 20,
    offset: number = 0,
  ): Promise<TrendingCall[]> {
    const cached = await this.cacheManager.get<TrendingCall[]>(
      this.TRENDING_CACHE_KEY,
    );
    if (Array.isArray(cached) && cached.length > 0) {
      this.logger.debug('Using cached trending feed results');
      return cached.slice(offset, offset + limit);
    }

    const computed = await this.calculateTrendingFeed();
    await this.cacheManager.set(this.TRENDING_CACHE_KEY, computed, 300);

    return computed.slice(offset, offset + limit);
  }

  async refreshTrendingCache(): Promise<TrendingCall[]> {
    const fresh = await this.calculateTrendingFeed();
    await this.cacheManager.set(this.TRENDING_CACHE_KEY, fresh, 300);
    return fresh;
  }

  async calculateTrendingFeed(): Promise<TrendingCall[]> {
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const rawRows = await this.stakeActivityRepository
      .createQueryBuilder('activity')
      .select('activity.callOnchainId', 'callOnchainId')
      .addSelect('SUM(activity.amount)', 'volume24h')
      .addSelect('COUNT(DISTINCT activity.stakerWallet)', 'participantCount24h')
      .where('activity.createdAt >= :windowStart', { windowStart })
      .groupBy('activity.callOnchainId')
      .orderBy('volume24h', 'DESC')
      .getRawMany<{
        callOnchainId: string;
        volume24h: string;
        participantCount24h: string;
      }>();

    if (!rawRows.length) {
      return [];
    }

    const callIds = rawRows.map((r) => r.callOnchainId);
    const calls = await this.callRepository.find({
      where: { callOnchainId: In(callIds), isHidden: false },
      relations: ['creator'],
    });

    const callById = new Map(calls.map((call) => [call.callOnchainId, call]));

    const trending: TrendingCall[] = rawRows
      .map((row) => {
        const targetCall = callById.get(row.callOnchainId);
        if (!targetCall) return null;

        const volume = Number(row.volume24h) || 0;
        const participants = Number(row.participantCount24h) || 0;
        const score = volume * (1 + Math.log(1 + participants));

        return {
          ...targetCall,
          volume24h: volume,
          participantCount24h: participants,
          trendingScore: Number(score.toFixed(6)),
          isHot: score >= 1,
        } as TrendingCall;
      })
      .filter(Boolean) as TrendingCall[];

    trending.sort((a, b) => b.trendingScore - a.trendingScore);
    return trending;
  }
}

