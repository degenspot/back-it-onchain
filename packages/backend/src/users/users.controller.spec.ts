import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let service: UsersService;

  const mockUsersService = {
    getProfile: jest.fn(),
    updateProfile: jest.fn(),
  };

  const mockRequest = {
    user: {
      id: 'user-123',
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -----------------------------
  // GET PROFILE
  // -----------------------------
  describe('getProfile', () => {
    it('should return user profile successfully', async () => {
      const mockProfile = {
        id: 'user-123',
        name: 'Elisha',
        email: 'elisha@test.com',
      };

      mockUsersService.getProfile.mockResolvedValue(mockProfile);

      const result = await controller.getProfile(mockRequest as any);

      expect(service.getProfile).toHaveBeenCalledWith('user-123');
      expect(result).toEqual(mockProfile);
    });

    it('should throw error if service fails', async () => {
      mockUsersService.getProfile.mockRejectedValue(
        new Error('User not found'),
      );

      await expect(
        controller.getProfile(mockRequest as any),
      ).rejects.toThrow('User not found');
    });
  });

  // -----------------------------
  // UPDATE PROFILE
  // -----------------------------
  describe('updateProfile', () => {
    it('should update profile successfully', async () => {
      const updateDto = {
        name: 'Updated Name',
      };

      const updatedUser = {
        id: 'user-123',
        name: 'Updated Name',
      };

      mockUsersService.updateProfile.mockResolvedValue(updatedUser);

      const result = await controller.updateProfile(
        mockRequest as any,
        updateDto,
      );

      expect(service.updateProfile).toHaveBeenCalledWith(
        'user-123',
        updateDto,
      );
      expect(result).toEqual(updatedUser);
    });

    it('should throw error if update fails', async () => {
      const updateDto = { name: 'Bad Update' };

      mockUsersService.updateProfile.mockRejectedValue(
        new Error('Update failed'),
      );

      await expect(
        controller.updateProfile(mockRequest as any, updateDto),
      ).rejects.toThrow('Update failed');
    });
  });
});