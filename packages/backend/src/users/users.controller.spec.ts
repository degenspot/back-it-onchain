import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { BadgesService } from '../badges/badges.service';

describe('UsersController', () => {
  let controller: UsersController;
  let service: UsersService;
  let badges: BadgesService;

  const mockUsersService = {
    findByWallet: jest.fn(),
    updateProfile: jest.fn(),
  };

  const mockBadgesService = {
    getUserBadges: jest.fn(),
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
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
    service = module.get<UsersService>(UsersService);
    badges = module.get<BadgesService>(BadgesService);
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

      await expect(
        controller.getUser('user-999'),
      ).rejects.toThrow('User not found');
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

      const result = await controller.updateProfile(
        'user-123',
        updateDto,
      );

      expect(service.updateProfile).toHaveBeenCalledWith(
        'user-123',
        updateDto,
      );
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
});