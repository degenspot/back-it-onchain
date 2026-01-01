import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Call } from '../calls/call.entity';
import { UserFollows } from '../users/user-follows.entity';

@Injectable()
export class FeedService {
    constructor(
        @InjectRepository(Call)
        private callRepository: Repository<Call>,
        @InjectRepository(UserFollows)
        private userFollowsRepository: Repository<UserFollows>,
    ) { }

    async getFollowingFeed(wallet: string, limit: number = 20, offset: number = 0): Promise<Call[]> {
        // 1. Get list of wallets the user follows
        const follows = await this.userFollowsRepository.find({
            where: { followerWallet: wallet },
            select: ['followingWallet'],
        });

        const followingWallets = follows.map(f => f.followingWallet);

        if (followingWallets.length === 0) {
            return [];
        }

        // 2. Get calls from these wallets
        return this.callRepository.find({
            where: { creatorWallet: In(followingWallets) },
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
        return this.callRepository.createQueryBuilder('call')
            .leftJoinAndSelect('call.creator', 'creator')
            .addSelect('(call.totalStakeYes + call.totalStakeNo)', 'total_stake')
            .orderBy('total_stake', 'DESC')
            .addOrderBy('call.createdAt', 'DESC')
            .take(limit)
            .skip(offset)
            .getMany();
    }
}
