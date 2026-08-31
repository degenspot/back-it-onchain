import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RelayerService } from './relayer.service';
import { AuditLog } from '../oracle/audit-log.entity';
import { Call } from '../calls/call.entity';
import { AdminService } from '../admin/admin.service';

describe('RelayerService', () => {
  let service: RelayerService;

  const mockAuditLogRepo = {
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockCallRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
  };

  const mockAdminService = {
    isPaused: jest.fn().mockReturnValue(false),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: string) => {
      const config: Record<string, string | undefined> = {
        BASE_SEPOLIA_RPC_URL: undefined,
        ORACLE_PRIVATE_KEY: undefined,
        OUTCOME_MANAGER_ADDRESS: undefined,
        STELLAR_ORACLE_SECRET_KEY: undefined,
        SOROBAN_RPC_URL: undefined,
        STELLAR_OUTCOME_MANAGER_CONTRACT_ID: undefined,
      };
      return config[key] ?? defaultValue;
    }),
  } as unknown as jest.Mocked<ConfigService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAdminService.isPaused.mockReturnValue(false);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RelayerService,
        { provide: getRepositoryToken(AuditLog), useValue: mockAuditLogRepo },
        { provide: getRepositoryToken(Call), useValue: mockCallRepo },
        { provide: AdminService, useValue: mockAdminService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<RelayerService>(RelayerService);
  });

  describe('Initialisation', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should not be Base-ready when config is missing', () => {
      expect(service.isBaseReady()).toBe(false);
    });

    it('should not be Stellar-ready when config is missing', () => {
      expect(service.isStellarReady()).toBe(false);
    });
  });

  describe('Circuit breaker', () => {
    it('should throw ServiceUnavailableException when protocol is paused', async () => {
      mockAdminService.isPaused.mockReturnValue(true);

      await expect(
        service.submitOutcome(
          'base',
          '1',
          1,
          true,
          100,
          Date.now(),
          '0xsignature',
        ),
      ).rejects.toThrow('Protocol is paused');
    });
  });

  describe('Idempotent submission guard', () => {
    it('should return false for isAlreadySubmitted when not submitted', () => {
      expect(service.isAlreadySubmitted('1', 'base')).toBe(false);
      expect(service.isAlreadySubmitted('1', 'stellar')).toBe(false);
    });

    it('should reset submission guard correctly', () => {
      expect(() => service.resetSubmission('1', 'base')).not.toThrow();
      expect(() => service.resetSubmission('1', 'stellar')).not.toThrow();
    });

    it('should return submission status as undefined when not submitted', () => {
      const status = service.getSubmissionStatus('1', 'base');
      expect(status).toBeUndefined();
    });
  });

  describe('Base (EVM) submission', () => {
    it('should fail gracefully when Base relayer is not initialised', async () => {
      const result = await service.submitOutcome(
        'base',
        '1',
        1,
        true,
        100,
        Date.now(),
        '0xsignature',
      );

      expect(result.success).toBe(false);
      expect(result.chain).toBe('base');
      expect(result.error).toContain('not initialised');
    });

    it('should record audit log on submission attempt', async () => {
      mockAuditLogRepo.create.mockReturnValue({} as AuditLog);
      mockAuditLogRepo.save.mockResolvedValue({} as AuditLog);

      await service.submitOutcome(
        'base',
        '1',
        1,
        true,
        100,
        Date.now(),
        '0xsignature',
      );

      expect(mockAuditLogRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SUBMISSION_ATTEMPT',
          actor: 'relayer-service',
        }),
      );
    });
  });

  describe('Stellar submission', () => {
    it('should fail gracefully when Stellar relayer is not initialised', async () => {
      const result = await service.submitOutcome(
        'stellar',
        '1',
        1,
        true,
        100,
        Date.now(),
        'base64signature',
      );

      expect(result.success).toBe(false);
      expect(result.chain).toBe('stellar');
      expect(result.error).toContain('not initialised');
    });

    it('should fail when Stellar outcome manager contract ID is not set', async () => {
      const configWithStellarKey = {
        get: jest.fn((key: string, defaultValue?: string) => {
          const config: Record<string, string | undefined> = {
            BASE_SEPOLIA_RPC_URL: undefined,
            ORACLE_PRIVATE_KEY: undefined,
            OUTCOME_MANAGER_ADDRESS: undefined,
            STELLAR_ORACLE_SECRET_KEY:
              'SCXJ4DAPQMXLKP3QITADMVLNX5Q7PV4L3BQKVME4N6TL5M2VJJYR7FAS',
            SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
            STELLAR_OUTCOME_MANAGER_CONTRACT_ID: undefined,
          };
          return config[key] ?? defaultValue;
        }),
      } as unknown as jest.Mocked<ConfigService>;

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RelayerService,
          {
            provide: getRepositoryToken(AuditLog),
            useValue: mockAuditLogRepo,
          },
          { provide: getRepositoryToken(Call), useValue: mockCallRepo },
          { provide: AdminService, useValue: mockAdminService },
          { provide: ConfigService, useValue: configWithStellarKey },
        ],
      }).compile();

      const stellarService = module.get<RelayerService>(RelayerService);
      expect(stellarService.isStellarReady()).toBe(true);

      const result = await stellarService.submitOutcome(
        'stellar',
        '1',
        1,
        true,
        100,
        Date.now(),
        'base64signature',
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('CONTRACT_ID not configured');
    });
  });

  describe('NonceManager', () => {
    it('should initialise Base relayer with proper config', async () => {
      const configWithBase = {
        get: jest.fn((key: string, defaultValue?: string) => {
          const config: Record<string, string | undefined> = {
            BASE_SEPOLIA_RPC_URL: 'https://sepolia.base.org',
            ORACLE_PRIVATE_KEY:
              '0x1234567890123456789012345678901234567890123456789012345678901234',
            OUTCOME_MANAGER_ADDRESS:
              '0x1234567890123456789012345678901234567890',
            STELLAR_ORACLE_SECRET_KEY: undefined,
            SOROBAN_RPC_URL: undefined,
            STELLAR_OUTCOME_MANAGER_CONTRACT_ID: undefined,
          };
          return config[key] ?? defaultValue;
        }),
      } as unknown as jest.Mocked<ConfigService>;

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RelayerService,
          {
            provide: getRepositoryToken(AuditLog),
            useValue: mockAuditLogRepo,
          },
          { provide: getRepositoryToken(Call), useValue: mockCallRepo },
          { provide: AdminService, useValue: mockAdminService },
          { provide: ConfigService, useValue: configWithBase },
        ],
      }).compile();

      const baseService = module.get<RelayerService>(RelayerService);
      expect(baseService.isBaseReady()).toBe(true);
    });
  });

  describe('Full integration with proper Stellar config', () => {
    let fullService: RelayerService;

    beforeEach(async () => {
      const fullConfig = {
        get: jest.fn((key: string, defaultValue?: string) => {
          const config: Record<string, string | undefined> = {
            BASE_SEPOLIA_RPC_URL: undefined,
            ORACLE_PRIVATE_KEY: undefined,
            OUTCOME_MANAGER_ADDRESS: undefined,
            STELLAR_ORACLE_SECRET_KEY:
              'SCXJ4DAPQMXLKP3QITADMVLNX5Q7PV4L3BQKVME4N6TL5M2VJJYR7FAS',
            SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
            STELLAR_OUTCOME_MANAGER_CONTRACT_ID:
              'CBAAOQHWALREVF2VJSI6M7B3O7R3YL4GJP5KJW3VLV5WZXQYJHSI5U47',
          };
          return config[key] ?? defaultValue;
        }),
      } as unknown as jest.Mocked<ConfigService>;

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RelayerService,
          {
            provide: getRepositoryToken(AuditLog),
            useValue: mockAuditLogRepo,
          },
          { provide: getRepositoryToken(Call), useValue: mockCallRepo },
          { provide: AdminService, useValue: mockAdminService },
          { provide: ConfigService, useValue: fullConfig },
        ],
      }).compile();

      fullService = module.get<RelayerService>(RelayerService);
    });

    it('should indicate Stellar is ready with proper config', () => {
      expect(fullService.isStellarReady()).toBe(true);
    });

    it('should not have idempotent guard set before submission', () => {
      expect(fullService.isAlreadySubmitted('100', 'stellar')).toBe(false);
      expect(fullService.getSubmissionStatus('100', 'stellar')).toBeUndefined();
    });

    it('should reset submission guard without error', () => {
      fullService.resetSubmission('100', 'stellar');
      expect(fullService.isAlreadySubmitted('100', 'stellar')).toBe(false);
    });
  });
});
