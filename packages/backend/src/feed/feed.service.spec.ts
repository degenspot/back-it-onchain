import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FeedService } from './feed.service';
import { Call } from '../calls/call.entity';
import { StakeActivity } from '../calls/stake-activity.entity';
import { UserFollows } from '../users/user-follows.entity';

const mockCall = (overrides: Partial<Call> = {}): Call =>
  ({
    id: 1,
    title: 'Test Call',
    description: 'A test prediction call',
    callOnchainId: '1',
    creatorWallet: '0xABC',
    ipfsCid: 'Qm123',
    tokenAddress: '0xTOKEN',
    pairId: null,
    stakeToken: '0xSTAKE',
    totalStakeYes: 100,
    totalStakeNo: 50,
    startTs: new Date('2026-01-01'),
    endTs: new Date('2026-06-01'),
    conditionJson: null,
    status: 'OPEN',
    outcome: null,
    finalPrice: null,
    oracleSignature: null,
    evidenceCid: null,
    chain: 'base',
    isHidden: false,
    reportCount: 0,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    creator: null,
    ...overrides,
  }) as Call;

describe('FeedService', () => {
  let service: FeedService;
  let callRepository: {
    find: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let userFollowsRepository: {
    find: jest.Mock;
  };
  let stakeActivityRepository: {
    createQueryBuilder: jest.Mock;
  };
  let cacheManager: {
    get: jest.Mock;
    set: jest.Mock;
  };

  // Reusable query builder mock
  const buildQueryBuilderMock = (returnValue: Call[]) => {
    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(returnValue),
    };
    return qb;
  };

  const buildActivityQueryBuilderMock = (returnValue: Array<any>) => {
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(returnValue),
    };
    return qb;
  };

  beforeEach(async () => {
    callRepository = {
      find: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    userFollowsRepository = {
      find: jest.fn(),
    };

    stakeActivityRepository = {
      createQueryBuilder: jest.fn(),
    };

    cacheManager = {
      get: jest.fn(),
      set: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedService,
        {
          provide: getRepositoryToken(Call),
          useValue: callRepository,
        },
        {
          provide: getRepositoryToken(UserFollows),
          useValue: userFollowsRepository,
        },
        {
          provide: getRepositoryToken(StakeActivity),
          useValue: stakeActivityRepository,
        },
        {
          provide: 'CACHE_MANAGER',
          useValue: cacheManager,
        },
      ],
    }).compile();

    service = module.get<FeedService>(FeedService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // getFollowingFeed
  // ---------------------------------------------------------------------------
  describe('getFollowingFeed', () => {
    it('returns empty array when the user follows nobody', async () => {
      userFollowsRepository.find.mockResolvedValue([]);

      const result = await service.getFollowingFeed('0xUSER');

      expect(result).toEqual([]);
      expect(callRepository.find).not.toHaveBeenCalled();
    });

    it('queries calls from followed wallets only', async () => {
      const follows: Partial<UserFollows>[] = [
        { followingWallet: '0xALICE' },
        { followingWallet: '0xBOB' },
      ];
      userFollowsRepository.find.mockResolvedValue(follows);

      const calls = [
        mockCall({ id: 1, creatorWallet: '0xALICE' }),
        mockCall({ id: 2, creatorWallet: '0xBOB' }),
      ];
      callRepository.find.mockResolvedValue(calls);

      const result = await service.getFollowingFeed('0xUSER');

      expect(userFollowsRepository.find).toHaveBeenCalledWith({
        where: { followerWallet: '0xUSER' },
        select: ['followingWallet'],
      });
      expect(callRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isHidden: false }),
          order: { createdAt: 'DESC' },
          relations: ['creator'],
        }),
      );
      expect(result).toHaveLength(2);
    });

    it('excludes hidden calls', async () => {
      userFollowsRepository.find.mockResolvedValue([
        { followingWallet: '0xALICE' },
      ]);

      const visibleCall = mockCall({ id: 1, isHidden: false });
      callRepository.find.mockResolvedValue([visibleCall]);

      await service.getFollowingFeed('0xUSER');

      const findArgs = callRepository.find.mock.calls[0][0];
      expect(findArgs.where).toMatchObject({ isHidden: false });
    });

    it('applies limit and offset pagination', async () => {
      userFollowsRepository.find.mockResolvedValue([
        { followingWallet: '0xALICE' },
      ]);
      callRepository.find.mockResolvedValue([]);

      await service.getFollowingFeed('0xUSER', 5, 10);

      const findArgs = callRepository.find.mock.calls[0][0];
      expect(findArgs.take).toBe(5);
      expect(findArgs.skip).toBe(10);
    });

    it('uses default limit=20 and offset=0', async () => {
      userFollowsRepository.find.mockResolvedValue([
        { followingWallet: '0xALICE' },
      ]);
      callRepository.find.mockResolvedValue([]);

      await service.getFollowingFeed('0xUSER');

      const findArgs = callRepository.find.mock.calls[0][0];
      expect(findArgs.take).toBe(20);
      expect(findArgs.skip).toBe(0);
    });

    it('orders results by createdAt DESC (newest first)', async () => {
      userFollowsRepository.find.mockResolvedValue([
        { followingWallet: '0xALICE' },
      ]);

      const older = mockCall({ id: 1, createdAt: new Date('2026-01-01') });
      const newer = mockCall({ id: 2, createdAt: new Date('2026-03-01') });
      // Simulate DB returning newest first
      callRepository.find.mockResolvedValue([newer, older]);

      const result = await service.getFollowingFeed('0xUSER');

      expect(result[0].id).toBe(2);
      expect(result[1].id).toBe(1);
    });

    it('includes creator relation', async () => {
      userFollowsRepository.find.mockResolvedValue([
        { followingWallet: '0xALICE' },
      ]);
      callRepository.find.mockResolvedValue([]);

      await service.getFollowingFeed('0xUSER');

      const findArgs = callRepository.find.mock.calls[0][0];
      expect(findArgs.relations).toContain('creator');
    });
  });

  // ---------------------------------------------------------------------------
  // getForYouFeed (global / trending)
  // ---------------------------------------------------------------------------
  describe('getForYouFeed', () => {
    it('returns calls sorted by total stake descending', async () => {
      const lowStakeCall = mockCall({
        id: 1,
        totalStakeYes: 10,
        totalStakeNo: 5,
      });
      const highStakeCall = mockCall({
        id: 2,
        totalStakeYes: 500,
        totalStakeNo: 300,
      });

      const qb = buildQueryBuilderMock([highStakeCall, lowStakeCall]);
      callRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getForYouFeed();

      expect(result[0].id).toBe(2);
      expect(result[1].id).toBe(1);
    });

    it('excludes hidden calls via where clause', async () => {
      const qb = buildQueryBuilderMock([]);
      callRepository.createQueryBuilder.mockReturnValue(qb);

      await service.getForYouFeed();

      expect(qb.where).toHaveBeenCalledWith('call.isHidden = :isHidden', {
        isHidden: false,
      });
    });

    it('adds total_stake computed select', async () => {
      const qb = buildQueryBuilderMock([]);
      callRepository.createQueryBuilder.mockReturnValue(qb);

      await service.getForYouFeed();

      expect(qb.addSelect).toHaveBeenCalledWith(
        '(call.totalStakeYes + call.totalStakeNo)',
        'total_stake',
      );
    });

    it('orders by total_stake DESC then createdAt DESC', async () => {
      const qb = buildQueryBuilderMock([]);
      callRepository.createQueryBuilder.mockReturnValue(qb);

      await service.getForYouFeed();

      expect(qb.orderBy).toHaveBeenCalledWith('total_stake', 'DESC');
      expect(qb.addOrderBy).toHaveBeenCalledWith('call.createdAt', 'DESC');
    });

    it('joins creator relation', async () => {
      const qb = buildQueryBuilderMock([]);
      callRepository.createQueryBuilder.mockReturnValue(qb);

      await service.getForYouFeed();

      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith(
        'call.creator',
        'creator',
      );
    });

    it('applies limit and offset pagination', async () => {
      const qb = buildQueryBuilderMock([]);
      callRepository.createQueryBuilder.mockReturnValue(qb);

      await service.getForYouFeed(10, 20);

      expect(qb.take).toHaveBeenCalledWith(10);
      expect(qb.skip).toHaveBeenCalledWith(20);
    });

    it('uses default limit=20 and offset=0', async () => {
      const qb = buildQueryBuilderMock([]);
      callRepository.createQueryBuilder.mockReturnValue(qb);

      await service.getForYouFeed();

      expect(qb.take).toHaveBeenCalledWith(20);
      expect(qb.skip).toHaveBeenCalledWith(0);
    });

    it('returns empty array when no calls exist', async () => {
      const qb = buildQueryBuilderMock([]);
      callRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getForYouFeed();

      expect(result).toEqual([]);
    });

    it('breaks ties in stake by createdAt (newest first)', async () => {
      const olderCall = mockCall({
        id: 1,
        totalStakeYes: 100,
        totalStakeNo: 100,
        createdAt: new Date('2026-01-01'),
      });
      const newerCall = mockCall({
        id: 2,
        totalStakeYes: 100,
        totalStakeNo: 100,
        createdAt: new Date('2026-03-01'),
      });
      // Simulate DB honouring the secondary sort
      const qb = buildQueryBuilderMock([newerCall, olderCall]);
      callRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getForYouFeed();

      expect(result[0].id).toBe(2);
      expect(result[1].id).toBe(1);
    });
  });

  describe('getTrendingFeed', () => {
    it('returns cached trending results if available', async () => {
      const trendingItem = {
        ...mockCall({ id: 1 }),
        trendingScore: 100,
        isHot: true,
        volume24h: 500,
        participantCount24h: 5,
      };

      cacheManager.get.mockResolvedValue([trendingItem]);

      const result = await service.getTrendingFeed(10, 0);
      expect(cacheManager.get).toHaveBeenCalledWith('feed:trending:24h');
      expect(result).toEqual([trendingItem]);
    });

    it('computes trending from stake activity when cache miss', async () => {
      cacheManager.get.mockResolvedValue(null);

      const activityRows = [
        {
          callOnchainId: '123',
          volume24h: '500',
          participantCount24h: '10',
        },
      ];

      const qb = buildActivityQueryBuilderMock(activityRows);
      stakeActivityRepository.createQueryBuilder.mockReturnValue(qb);

      const call = mockCall({ id: 1, callOnchainId: '123', totalStakeYes: 400, totalStakeNo: 100 });
      callRepository.find.mockResolvedValue([call]);

      const result = await service.getTrendingFeed(10, 0);

      expect(stakeActivityRepository.createQueryBuilder).toHaveBeenCalledWith('activity');
      expect(callRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ callOnchainId: In(['123']), isHidden: false }),
          relations: ['creator'],
        }),
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 1,
        volume24h: 500,
        participantCount24h: 10,
        isHot: true,
      });
      expect(cacheManager.set).toHaveBeenCalledWith('feed:trending:24h', expect.any(Array), { ttl: 300 });
    });
  });
});
