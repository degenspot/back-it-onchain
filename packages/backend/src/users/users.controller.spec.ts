import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { BadgesService } from '../badges/badges.service';
import { CallsService } from '../calls/calls.service';

describe('UsersController', () => {
  let controller: UsersController;
  let service: UsersService;
  let badges: BadgesService;
  let calls: CallsService;

  const mockUsersService = {
    findByWallet: jest.fn(),
    updateProfile: jest.fn(),
    exportHistory: jest.fn(),
    getSettings: jest.fn(),
    upsertSettings: jest.fn(),
    follow: jest.fn(),
    unfollow: jest.fn(),
    getSocialStats: jest.fn(),
    getReferralStats: jest.fn(),
    isFollowing: jest.fn(),
  };

  const mockBadgesService = {
    getUserBadges: jest.fn(),
  };

  const mockCallsService = {
    getStakesByWallet: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
        {
          provide: BadgesService,
          useValue: mockBadgesService,
        },
        {
          provide: CallsService,
          useValue: mockCallsService,
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
    service = module.get<UsersService>(UsersService);
    badges = module.get<BadgesService>(BadgesService);
    calls = module.get<CallsService>(CallsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getUser', () => {
    it('should return user profile with badges successfully', async () => {
      const mockUser = {
        wallet: 'user-123',
        handle: 'elisha',
      };
      const mockBadges = [{ id: 1, name: 'First Call' }];

      mockUsersService.findByWallet.mockResolvedValue(mockUser);
      mockBadgesService.getUserBadges.mockResolvedValue(mockBadges);

      const result = await controller.getUser('user-123');

      expect(service.findByWallet).toHaveBeenCalledWith('user-123');
      expect(badges.getUserBadges).toHaveBeenCalledWith('user-123');
      expect(result).toEqual({ ...mockUser, badges: mockBadges });
    });

    it('should throw error if user not found', async () => {
      mockUsersService.findByWallet.mockResolvedValue(null);

      await expect(controller.getUser('user-999')).rejects.toThrow(
        'User not found',
      );
    });
  });

  describe('updateProfile', () => {
    it('should update profile successfully', async () => {
      const updateDto = {
        displayName: 'Updated Name',
      };

      const updatedUser = {
        wallet: 'user-123',
        displayName: 'Updated Name',
      };

      mockUsersService.updateProfile.mockResolvedValue(updatedUser);

      const result = await controller.updateProfile('user-123', updateDto);

      expect(service.updateProfile).toHaveBeenCalledWith('user-123', updateDto);
      expect(result).toEqual(updatedUser);
    });

    it('should throw error if update fails', async () => {
      const updateDto = { displayName: 'Bad Update' };

      mockUsersService.updateProfile.mockRejectedValue(
        new Error('Update failed'),
      );

      await expect(
        controller.updateProfile('user-123', updateDto),
      ).rejects.toThrow('Update failed');
    });
  });

  describe('getStakes', () => {
    it('should return user stakes successfully', async () => {
      const mockStakes = [
        { id: 1, callId: 10, amount: 100, status: 'active' },
      ];
      mockCallsService.getStakesByWallet.mockResolvedValue(mockStakes);

      const result = await controller.getStakes('user-123');

      expect(calls.getStakesByWallet).toHaveBeenCalledWith('user-123');
      expect(result).toEqual(mockStakes);
    });
  });
});
