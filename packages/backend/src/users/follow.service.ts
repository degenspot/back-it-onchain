import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Follow } from './entities/follow.entity';
import { User } from './entities/user.entity';
import { FollowResponseDto, FollowStatsDto } from './dto/follow.dto';

@Injectable()
export class FollowService {
  constructor(
    @InjectRepository(Follow)
    private readonly followRepository: Repository<Follow>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async followUser(
    currentUserAddress: string,
    targetAddress: string,
  ): Promise<{ message: string }> {
    if (currentUserAddress.toLowerCase() === targetAddress.toLowerCase()) {
      throw new BadRequestException('You cannot follow yourself');
    }

    const [currentUser, targetUser] = await Promise.all([
      this.userRepository.findOne({
        where: { address: currentUserAddress.toLowerCase() },
      }),
      this.userRepository.findOne({
        where: { address: targetAddress.toLowerCase() },
      }),
    ]);

    if (!currentUser) {
      throw new NotFoundException('Current user not found');
    }
    if (!targetUser) {
      throw new NotFoundException('Target user not found');
    }

    const existingFollow = await this.followRepository.findOne({
      where: {
        followerId: currentUser.id,
        followingId: targetUser.id,
      },
    });

    if (existingFollow) {
      throw new ConflictException('You are already following this user');
    }

    const follow = this.followRepository.create({
      followerId: currentUser.id,
      followingId: targetUser.id,
    });

    await this.followRepository.save(follow);

    return { message: `You are now following ${targetAddress}` };
  }

  async unfollowUser(
    currentUserAddress: string,
    targetAddress: string,
  ): Promise<{ message: string }> {
    if (currentUserAddress.toLowerCase() === targetAddress.toLowerCase()) {
      throw new BadRequestException('You cannot unfollow yourself');
    }

    const [currentUser, targetUser] = await Promise.all([
      this.userRepository.findOne({
        where: { address: currentUserAddress.toLowerCase() },
      }),
      this.userRepository.findOne({
        where: { address: targetAddress.toLowerCase() },
      }),
    ]);

    if (!currentUser) {
      throw new NotFoundException('Current user not found');
    }
    if (!targetUser) {
      throw new NotFoundException('Target user not found');
    }

    const existingFollow = await this.followRepository.findOne({
      where: {
        followerId: currentUser.id,
        followingId: targetUser.id,
      },
    });

    if (!existingFollow) {
      throw new BadRequestException('You are not following this user');
    }

    await this.followRepository.remove(existingFollow);

    return { message: `You have unfollowed ${targetAddress}` };
  }

  async getFollowers(
    address: string,
    page = 1,
    limit = 20,
  ): Promise<{ data: FollowResponseDto[]; total: number }> {
    const user = await this.userRepository.findOne({
      where: { address: address.toLowerCase() },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const [follows, total] = await this.followRepository.findAndCount({
      where: { followingId: user.id },
      relations: ['follower'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const data: FollowResponseDto[] = follows.map((f) => ({
      id: f.follower.id,
      address: f.follower.address,
      username: f.follower.username,
      avatar: f.follower.avatar,
      followedAt: f.createdAt,
    }));

    return { data, total };
  }

  async getFollowing(
    address: string,
    page = 1,
    limit = 20,
  ): Promise<{ data: FollowResponseDto[]; total: number }> {
    const user = await this.userRepository.findOne({
      where: { address: address.toLowerCase() },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const [follows, total] = await this.followRepository.findAndCount({
      where: { followerId: user.id },
      relations: ['following'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const data: FollowResponseDto[] = follows.map((f) => ({
      id: f.following.id,
      address: f.following.address,
      username: f.following.username,
      avatar: f.following.avatar,
      followedAt: f.createdAt,
    }));

    return { data, total };
  }

  async getFollowStats(address: string): Promise<FollowStatsDto> {
    const user = await this.userRepository.findOne({
      where: { address: address.toLowerCase() },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const [followersCount, followingCount] = await Promise.all([
      this.followRepository.count({ where: { followingId: user.id } }),
      this.followRepository.count({ where: { followerId: user.id } }),
    ]);

    return { followersCount, followingCount };
  }

  async isFollowing(
    currentUserAddress: string,
    targetAddress: string,
  ): Promise<{ isFollowing: boolean }> {
    const [currentUser, targetUser] = await Promise.all([
      this.userRepository.findOne({
        where: { address: currentUserAddress.toLowerCase() },
      }),
      this.userRepository.findOne({
        where: { address: targetAddress.toLowerCase() },
      }),
    ]);

    if (!currentUser || !targetUser) {
      return { isFollowing: false };
    }

    const follow = await this.followRepository.findOne({
      where: {
        followerId: currentUser.id,
        followingId: targetUser.id,
      },
    });

    return { isFollowing: !!follow };
  }
}
