import { Test, TestingModule } from '@nestjs/testing';
import { CallsService } from './calls.service';
import { CallRepository } from './calls.repository';
import { BadRequestException } from '@nestjs/common';

describe('CallsService', () => {
  let service: CallsService;
  let repository: CallRepository;

  const mockCallRepository = {
    create: jest.fn(),
    findById: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallsService,
        {
          provide: CallRepository,
          useValue: mockCallRepository,
        },
      ],
    }).compile();

    service = module.get<CallsService>(CallsService);
    repository = module.get<CallRepository>(CallRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -----------------------------
  // CREATE CALL
  // -----------------------------
  describe('createCall', () => {
    it('should create a call successfully', async () => {
      const callData = { market: 'BTC', prediction: 'UP' };
      const mockResult = { id: 'call-123', ...callData };

      mockCallRepository.create.mockResolvedValue(mockResult);

      const result = await service.createCall(callData);

      expect(repository.create).toHaveBeenCalledWith(callData);
      expect(result).toEqual(mockResult);
    });

    it('should throw BadRequestException for invalid input', async () => {
      const invalidData = { market: '', prediction: '' };

      await expect(service.createCall(invalidData)).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  // -----------------------------
  // GET CALL BY ID
  // -----------------------------
  describe('getCallById', () => {
    it('should return call when found', async () => {
      const mockCall = { id: 'call-123', market: 'ETH', prediction: 'DOWN' };
      mockCallRepository.findById.mockResolvedValue(mockCall);

      const result = await service.getCallById('call-123');

      expect(repository.findById).toHaveBeenCalledWith('call-123');
      expect(result).toEqual(mockCall);
    });

    it('should throw error when call not found', async () => {
      mockCallRepository.findById.mockResolvedValue(null);

      await expect(service.getCallById('call-999')).rejects.toThrow(
        'Call not found',
      );
    });
  });
});