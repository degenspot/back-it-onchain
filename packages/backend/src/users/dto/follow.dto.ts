export class FollowResponseDto {
  id: string;
  address: string;
  username?: string;
  avatar?: string;
  followedAt: Date;
}

export class FollowStatsDto {
  followersCount: number;
  followingCount: number;
}
