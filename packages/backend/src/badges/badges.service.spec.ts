import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BadgesService } from './badges.service';
import { UserBadge } from './badge.entity';
import { BadgeKey } from './badge-definitions';

describe('BadgesService', () => {
  let service: BadgesService;
  let userBadgeRepo: Repository<UserBadge>;
  let dataSource: DataSource;

  const mockUserBadgeRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  const mockDataSource = {
    query: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BadgesService,
        {
          provide: getRepositoryToken(UserBadge),
          useValue: mockUserBadgeRepo,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<BadgesService>(BadgesService);
    userBadgeRepo = module.get<Repository<UserBadge>>(
      getRepositoryToken(UserBadge),
    );
    dataSource = module.get<DataSource>(DataSource);

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('getUserBadges', () => {
    it('should return user badges ordered by grantedAt', async () => {
      const wallet = '0x123';
      const badges = [
        {
          id: '1',
          wallet,
          badge: BadgeKey.FIRST_CALL,
          grantedAt: new Date('2023-01-01'),
        },
        {
          id: '2',
          wallet,
          badge: BadgeKey.FIVE_WINS,
          grantedAt: new Date('2023-01-02'),
        },
      ];
      mockUserBadgeRepo.find.mockResolvedValue(badges);

      const result = await service.getUserBadges(wallet);

      expect(mockUserBadgeRepo.find).toHaveBeenCalledWith({
        where: { wallet },
        order: { grantedAt: 'ASC' },
      });
      expect(result).toEqual(badges);
    });
  });

  describe('checkAndGrantBadges', () => {
    const wallet = '0x123';

    beforeEach(() => {
      // Mock the threshold queries
      mockDataSource.query
        .mockResolvedValueOnce([{ cnt: '5' }]) // callCount
        .mockResolvedValueOnce([{ cnt: '7' }]) // winsCount
        .mockResolvedValueOnce([{ total: '1500.5' }]) // totalStake
        .mockResolvedValueOnce([{ cnt: '12' }]); // followerCount

      // Mock findOne for existing badges check
      mockUserBadgeRepo.findOne.mockResolvedValue(null); // No existing badges

      // Mock create and save
      mockUserBadgeRepo.create.mockImplementation((data) => data);
      mockUserBadgeRepo.save.mockResolvedValue({});
    });

    it('should grant multiple badges when thresholds are met', async () => {
      await service.checkAndGrantBadges(wallet);

      // Should check for existing badges
      expect(mockUserBadgeRepo.findOne).toHaveBeenCalledTimes(5);
      expect(mockUserBadgeRepo.findOne).toHaveBeenCalledWith({
        where: { wallet, badge: BadgeKey.FIRST_CALL },
      });
      expect(mockUserBadgeRepo.findOne).toHaveBeenCalledWith({
        where: { wallet, badge: BadgeKey.FIVE_WINS },
      });
      expect(mockUserBadgeRepo.findOne).toHaveBeenCalledWith({
        where: { wallet, badge: BadgeKey.TEN_WINS },
      });
      expect(mockUserBadgeRepo.findOne).toHaveBeenCalledWith({
        where: { wallet, badge: BadgeKey.WHALE_STAKER },
      });
      expect(mockUserBadgeRepo.findOne).toHaveBeenCalledWith({
        where: { wallet, badge: BadgeKey.SOCIAL_BUTTERFLY },
      });

      // Should create and save badges
      expect(mockUserBadgeRepo.create).toHaveBeenCalledTimes(5);
      expect(mockUserBadgeRepo.save).toHaveBeenCalledTimes(5);
    });

    it('should not grant badges that are already earned', async () => {
      mockUserBadgeRepo.findOne
        .mockResolvedValueOnce(null) // FIRST_CALL not earned
        .mockResolvedValueOnce({ id: '1', wallet, badge: BadgeKey.FIVE_WINS }) // FIVE_WINS already earned
        .mockResolvedValueOnce(null) // TEN_WINS not earned
        .mockResolvedValueOnce(null) // WHALE_STAKER not earned
        .mockResolvedValueOnce(null); // SOCIAL_BUTTERFLY not earned

      await service.checkAndGrantBadges(wallet);

      expect(mockUserBadgeRepo.create).toHaveBeenCalledTimes(4); // Only 4 new badges
      expect(mockUserBadgeRepo.save).toHaveBeenCalledTimes(4);
    });

    it('should grant no badges when no thresholds are met', async () => {
      // Mock low values
      mockDataSource.query
        .mockResolvedValueOnce([{ cnt: '0' }]) // callCount = 0
        .mockResolvedValueOnce([{ cnt: '2' }]) // winsCount = 2
        .mockResolvedValueOnce([{ total: '500' }]) // totalStake = 500
        .mockResolvedValueOnce([{ cnt: '5' }]); // followerCount = 5

      await service.checkAndGrantBadges(wallet);

      expect(mockUserBadgeRepo.findOne).not.toHaveBeenCalled();
      expect(mockUserBadgeRepo.create).not.toHaveBeenCalled();
      expect(mockUserBadgeRepo.save).not.toHaveBeenCalled();
    });

    it('should grant only FIRST_CALL when callCount >= 1', async () => {
      mockDataSource.query
        .mockResolvedValueOnce([{ cnt: '1' }]) // callCount = 1
        .mockResolvedValueOnce([{ cnt: '0' }]) // winsCount = 0
        .mockResolvedValueOnce([{ total: '0' }]) // totalStake = 0
        .mockResolvedValueOnce([{ cnt: '0' }]); // followerCount = 0

      await service.checkAndGrantBadges(wallet);

      expect(mockUserBadgeRepo.findOne).toHaveBeenCalledTimes(1);
      expect(mockUserBadgeRepo.findOne).toHaveBeenCalledWith({
        where: { wallet, badge: BadgeKey.FIRST_CALL },
      });
      expect(mockUserBadgeRepo.create).toHaveBeenCalledTimes(1);
      expect(mockUserBadgeRepo.save).toHaveBeenCalledTimes(1);
    });

    it('should grant FIVE_WINS and TEN_WINS when winsCount >= 10', async () => {
      mockDataSource.query
        .mockResolvedValueOnce([{ cnt: '0' }]) // callCount = 0
        .mockResolvedValueOnce([{ cnt: '10' }]) // winsCount = 10
        .mockResolvedValueOnce([{ total: '0' }]) // totalStake = 0
        .mockResolvedValueOnce([{ cnt: '0' }]); // followerCount = 0

      await service.checkAndGrantBadges(wallet);

      expect(mockUserBadgeRepo.findOne).toHaveBeenCalledTimes(2);
      expect(mockUserBadgeRepo.findOne).toHaveBeenCalledWith({
        where: { wallet, badge: BadgeKey.FIVE_WINS },
      });
      expect(mockUserBadgeRepo.findOne).toHaveBeenCalledWith({
        where: { wallet, badge: BadgeKey.TEN_WINS },
      });
      expect(mockUserBadgeRepo.create).toHaveBeenCalledTimes(2);
      expect(mockUserBadgeRepo.save).toHaveBeenCalledTimes(2);
    });

    it('should grant WHALE_STAKER when totalStake >= 1000', async () => {
      mockDataSource.query
        .mockResolvedValueOnce([{ cnt: '0' }]) // callCount = 0
        .mockResolvedValueOnce([{ cnt: '0' }]) // winsCount = 0
        .mockResolvedValueOnce([{ total: '1000' }]) // totalStake = 1000
        .mockResolvedValueOnce([{ cnt: '0' }]); // followerCount = 0

      await service.checkAndGrantBadges(wallet);

      expect(mockUserBadgeRepo.findOne).toHaveBeenCalledTimes(1);
      expect(mockUserBadgeRepo.findOne).toHaveBeenCalledWith({
        where: { wallet, badge: BadgeKey.WHALE_STAKER },
      });
      expect(mockUserBadgeRepo.create).toHaveBeenCalledTimes(1);
      expect(mockUserBadgeRepo.save).toHaveBeenCalledTimes(1);
    });

    it('should grant SOCIAL_BUTTERFLY when followerCount >= 10', async () => {
      mockDataSource.query
        .mockResolvedValueOnce([{ cnt: '0' }]) // callCount = 0
        .mockResolvedValueOnce([{ cnt: '0' }]) // winsCount = 0
        .mockResolvedValueOnce([{ total: '0' }]) // totalStake = 0
        .mockResolvedValueOnce([{ cnt: '10' }]); // followerCount = 10

      await service.checkAndGrantBadges(wallet);

      expect(mockUserBadgeRepo.findOne).toHaveBeenCalledTimes(1);
      expect(mockUserBadgeRepo.findOne).toHaveBeenCalledWith({
        where: { wallet, badge: BadgeKey.SOCIAL_BUTTERFLY },
      });
      expect(mockUserBadgeRepo.create).toHaveBeenCalledTimes(1);
      expect(mockUserBadgeRepo.save).toHaveBeenCalledTimes(1);
    });

    it('should handle database errors gracefully', async () => {
      mockDataSource.query.mockRejectedValue(
        new Error('Database connection failed'),
      );

      await expect(service.checkAndGrantBadges(wallet)).resolves.not.toThrow();

      expect(mockUserBadgeRepo.create).not.toHaveBeenCalled();
      expect(mockUserBadgeRepo.save).not.toHaveBeenCalled();
    });

    it('should handle save errors gracefully', async () => {
      mockUserBadgeRepo.save.mockRejectedValue(new Error('Save failed'));

      await expect(service.checkAndGrantBadges(wallet)).resolves.not.toThrow();
    });
  });

  describe('grantIfNew', () => {
    const wallet = '0x123';

    it('should grant badge if not already exists', async () => {
      mockUserBadgeRepo.findOne.mockResolvedValue(null);
      mockUserBadgeRepo.create.mockReturnValue({
        wallet,
        badge: BadgeKey.FIRST_CALL,
      });
      mockUserBadgeRepo.save.mockResolvedValue({});

      await (service as any).grantIfNew(wallet, BadgeKey.FIRST_CALL);

      expect(mockUserBadgeRepo.findOne).toHaveBeenCalledWith({
        where: { wallet, badge: BadgeKey.FIRST_CALL },
      });
      expect(mockUserBadgeRepo.create).toHaveBeenCalledWith({
        wallet,
        badge: BadgeKey.FIRST_CALL,
      });
      expect(mockUserBadgeRepo.save).toHaveBeenCalledWith({
        wallet,
        badge: BadgeKey.FIRST_CALL,
      });
    });

    it('should not grant badge if already exists', async () => {
      mockUserBadgeRepo.findOne.mockResolvedValue({
        id: '1',
        wallet,
        badge: BadgeKey.FIRST_CALL,
      });

      await (service as any).grantIfNew(wallet, BadgeKey.FIRST_CALL);

      expect(mockUserBadgeRepo.findOne).toHaveBeenCalledWith({
        where: { wallet, badge: BadgeKey.FIRST_CALL },
      });
      expect(mockUserBadgeRepo.create).not.toHaveBeenCalled();
      expect(mockUserBadgeRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('Threshold queries', () => {
    const wallet = '0x123';

    describe('getCallCount', () => {
      it('should return the count of non-hidden calls', async () => {
        mockDataSource.query.mockResolvedValue([{ cnt: '5' }]);

        const result = await (service as any).getCallCount(wallet);

        expect(mockDataSource.query).toHaveBeenCalledWith(
          `SELECT COUNT(*)::int AS cnt FROM "call"
           WHERE creator_wallet = $1 AND is_hidden = false`,
          [wallet],
        );
        expect(result).toBe(5);
      });
    });

    describe('getWinsCount', () => {
      it('should return the count of resolved winning calls', async () => {
        mockDataSource.query.mockResolvedValue([{ cnt: '3' }]);

        const result = await (service as any).getWinsCount(wallet);

        expect(mockDataSource.query).toHaveBeenCalledWith(
          `SELECT COUNT(*)::int AS cnt FROM "call"
           WHERE creator_wallet = $1 AND status = 'RESOLVED' AND outcome = true`,
          [wallet],
        );
        expect(result).toBe(3);
      });
    });

    describe('getTotalStake', () => {
      it('should return the total stake across all non-hidden calls', async () => {
        mockDataSource.query.mockResolvedValue([{ total: '1234.56' }]);

        const result = await (service as any).getTotalStake(wallet);

        expect(mockDataSource.query).toHaveBeenCalledWith(
          `SELECT COALESCE(SUM(total_stake_yes + total_stake_no), 0) AS total
           FROM "call" WHERE creator_wallet = $1 AND is_hidden = false`,
          [wallet],
        );
        expect(result).toBe(1234.56);
      });

      it('should return 0 when no calls exist', async () => {
        mockDataSource.query.mockResolvedValue([{ total: null }]);

        const result = await (service as any).getTotalStake(wallet);

        expect(result).toBe(0);
      });
    });

    describe('getFollowerCount', () => {
      it('should return the count of followers', async () => {
        mockDataSource.query.mockResolvedValue([{ cnt: '15' }]);

        const result = await (service as any).getFollowerCount(wallet);

        expect(mockDataSource.query).toHaveBeenCalledWith(
          `SELECT COUNT(*)::int AS cnt FROM user_follows
           WHERE following_wallet = $1`,
          [wallet],
        );
        expect(result).toBe(15);
      });
    });
  });
});
