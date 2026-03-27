import { Test, TestingModule } from '@nestjs/testing';
import { CallsService } from './calls.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Call } from './call.entity';
import { Repository } from 'typeorm';

describe('CallsService', () => {
  let service: CallsService;
  let repository: Repository<Call>;

  const mockCallRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
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

  // -----------------------------
  // FIND ONE
  // -----------------------------
  describe('findOne', () => {
    it('should return call when found', async () => {
      const mockCall = { id: 123, title: 'ETH', description: 'DOWN' };
      mockCallRepository.findOne.mockResolvedValue(mockCall);

      const result = await service.findOne(123);

      expect(repository.findOne).toHaveBeenCalledWith({ where: { id: 123 } });
      expect(result).toEqual(mockCall);
    });

    it('should return null when call not found', async () => {
      mockCallRepository.findOne.mockResolvedValue(null);

      const result = await service.findOne(999);
      expect(result).toBeNull();
    });
  });
});