import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import { UserFollows } from './user-follows.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(UserFollows)
    private userFollowsRepository: Repository<UserFollows>,
  ) {}

  async findByWallet(wallet: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { wallet } });
  }

  async findByHandle(handle: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { handle } });
  }

  async updateProfile(
    wallet: string,
    updateData: {
      handle?: string;
      bio?: string;
      displayName?: string;
      avatarCid?: string;
    },
  ): Promise<User> {
    const user = await this.findByWallet(wallet);
    if (!user) {
      throw new Error('User not found');
    }

    if (updateData.handle) {
      const existingUser = await this.findByHandle(updateData.handle);
      if (existingUser && existingUser.wallet !== wallet) {
        throw new ConflictException('Handle already taken');
      }
    }

    Object.assign(user, updateData);
    return this.usersRepository.save(user);
  }

  async follow(followerWallet: string, followingWallet: string): Promise<void> {
    if (followerWallet === followingWallet) {
      throw new ConflictException('Cannot follow yourself');
    }

    const existing = await this.userFollowsRepository.findOne({
      where: { followerWallet, followingWallet },
    });

    if (existing) {
      return; // Already following
    }

    const follow = this.userFollowsRepository.create({
      followerWallet,
      followingWallet,
    });
    await this.userFollowsRepository.save(follow);
  }

  async unfollow(
    followerWallet: string,
    followingWallet: string,
  ): Promise<void> {
    await this.userFollowsRepository.delete({
      followerWallet,
      followingWallet,
    });
  }

  async getSocialStats(
    wallet: string,
  ): Promise<{ followersCount: number; followingCount: number }> {
    const followersCount = await this.userFollowsRepository.count({
      where: { followingWallet: wallet },
    });
    const followingCount = await this.userFollowsRepository.count({
      where: { followerWallet: wallet },
    });
    return { followersCount, followingCount };
  }

  async getReferralStats(
    wallet: string,
  ): Promise<{ successfulReferralCount: number }> {
    const successfulReferralCount = await this.usersRepository.count({
      where: { referredBy: wallet },
    });
    return { successfulReferralCount };
  }

  async isFollowing(
    followerWallet: string,
    followingWallet: string,
  ): Promise<boolean> {
    const count = await this.userFollowsRepository.count({
      where: { followerWallet, followingWallet },
    });
    return count > 0;
  }
}
