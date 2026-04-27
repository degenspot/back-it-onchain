import { Test, TestingModule } from '@nestjs/testing';
import { CallsService } from './calls.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Call } from './call.entity';
import { Repository } from 'typeorm';
import { NotFoundException } from '@nestjs/common';

describe('CallsService', () => {
  let service: CallsService;
  let repository: Repository<Call>;

  const mockCallRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallsService,
        {
          provide: getRepositoryToken(Call),
          useValue: mockCallRepository,
        },
      ],
    }).compile();

    service = module.get<CallsService>(CallsService);
    repository = module.get<Repository<Call>>(getRepositoryToken(Call));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -----------------------------
  // CREATE
  // -----------------------------
  describe('create', () => {
    it('should create a call successfully', async () => {
      const callData = { title: 'BTC', description: 'UP' };
      const mockResult = { id: 123, ...callData };

      mockCallRepository.create.mockReturnValue(callData);
      mockCallRepository.save.mockResolvedValue(mockResult);

      const result = await service.create(callData as unknown as Partial<Call>);

      expect(repository.create).toHaveBeenCalledWith(callData);
      expect(repository.save).toHaveBeenCalledWith(callData);
      expect(result).toEqual(mockResult);
    });
  });

  describe('findAll', () => {
    it('should return paginated calls with metadata', async () => {
      const mockCalls = [
        { id: 1, title: 'ETH', description: 'UP' },
        { id: 2, title: 'BTC', description: 'DOWN' },
      ];

      mockCallRepository.findAndCount.mockResolvedValue([mockCalls, 17]);

      const result = await service.findAll({
        chain: 'base',
        limit: 20,
        offset: 10,
      });

      expect(repository.findAndCount).toHaveBeenCalledWith({
        where: { isHidden: false, chain: 'base' },
        order: { createdAt: 'DESC' },
        relations: ['creator'],
        take: 20,
        skip: 10,
      });
      expect(result).toEqual({
        data: mockCalls,
        meta: {
          total: 17,
          limit: 20,
          offset: 10,
        },
      });
    });
  });

  describe('findOne', () => {
    it('should return a call envelope when found', async () => {
      const mockCall = { id: 123, title: 'ETH', description: 'DOWN' };
      mockCallRepository.findOne.mockResolvedValue(mockCall);

      const result = await service.findOne(123);

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: 123 },
        relations: ['creator'],
      });
      expect(result).toEqual({
        data: mockCall,
        meta: null,
      });
    });

    it('should throw when call is not found', async () => {
      mockCallRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne(999)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('report', () => {
    it('should increment the report count and persist the call', async () => {
      const mockCall = { id: 50, reportCount: 2, isHidden: false } as Call;
      mockCallRepository.findOne.mockResolvedValue(mockCall);
      mockCallRepository.save.mockResolvedValue(mockCall);

      const result = await service.report(50, 'Spam', '0xReporter');

      expect(repository.save).toHaveBeenCalledWith({
        ...mockCall,
        reportCount: 3,
        lastReporterWallet: '0xReporter',
      });
      expect(result).toEqual({
        success: true,
        message: 'Report submitted successfully',
      });
    });

    it('should hide a call after five reports', async () => {
      const mockCall = { id: 50, reportCount: 4, isHidden: false } as Call;
      mockCallRepository.findOne.mockResolvedValue(mockCall);
      mockCallRepository.save.mockResolvedValue(mockCall);

      await service.report(50, 'Offensive', '0xReporter2');

      expect(repository.save).toHaveBeenCalledWith({
        ...mockCall,
        reportCount: 5,
        isHidden: true,
        lastReporterWallet: '0xReporter2',
      });
    });

    it('should throw when the reported call does not exist', async () => {
      mockCallRepository.findOne.mockResolvedValue(null);

      await expect(service.report(999, 'Spam', '0xReporter')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
