import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { IndexerDlqService, DlqJobData, INDEXER_DLQ_QUEUE } from './indexer-dlq.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeSampleJob = (overrides: Partial<DlqJobData> = {}): DlqJobData => ({
  contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
  ledger: 12345,
  rawXdr: 'AAAAAQAAAAC...',
  errorMessage: 'Cannot read XDR symbol',
  errorStack: 'Error: Cannot read XDR symbol\n    at parseEvent (...)',
  failedAt: '2026-09-25T10:00:00.000Z',
  attemptsMade: 5,
  ...overrides,
});

// Minimal BullMQ Queue mock
const mockJobId = 'abc123';
const mockJob = { id: mockJobId, data: makeSampleJob(), failedReason: 'XDR parse error', attemptsMade: 5, timestamp: Date.now() };

const mockQueueAdd = jest.fn().mockResolvedValue(mockJob);
const mockQueueGetJobs = jest.fn().mockResolvedValue([mockJob]);
const mockJobFromId = jest.fn().mockResolvedValue(mockJob);

jest.mock('bullmq', () => {
  return {
    Queue: jest.fn().mockImplementation(() => ({
      add: mockQueueAdd,
      getJobs: mockQueueGetJobs,
    })),
    Job: {
      fromId: (...args: any[]) => mockJobFromId(...args),
    },
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IndexerDlqService', () => {
  let service: IndexerDlqService;
  let configService: jest.Mocked<ConfigService>;

  const buildModule = async (redisUrl: string | undefined) => {
    configService = {
      get: jest.fn().mockImplementation((key: string, defaultVal?: any) => {
        if (key === 'REDIS_URL') return redisUrl;
        if (key === 'INDEXER_DLQ_JOB_TTL_MS') return defaultVal ?? 604800000;
        if (key === 'DISCORD_ADMIN_WEBHOOK_URL') return undefined;
        return defaultVal;
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IndexerDlqService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<IndexerDlqService>(IndexerDlqService);
    service.onModuleInit();
    return module;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── no-op mode (no Redis) ────────────────────────────────────────────────

  describe('when REDIS_URL is not set', () => {
    beforeEach(async () => {
      await buildModule(undefined);
    });

    it('should not throw when addFailedEvent is called', async () => {
      await expect(service.addFailedEvent(makeSampleJob())).resolves.toBeUndefined();
    });

    it('should return empty array from listJobs', async () => {
      const jobs = await service.listJobs();
      expect(jobs).toEqual([]);
    });

    it('should return queued=false from retryJob', async () => {
      const result = await service.retryJob('some-id');
      expect(result.queued).toBe(false);
    });
  });

  // ── happy path (Redis configured) ───────────────────────────────────────

  describe('when REDIS_URL is set', () => {
    beforeEach(async () => {
      await buildModule('redis://localhost:6379');
    });

    it('should park a failed event as a BullMQ job', async () => {
      const data = makeSampleJob();
      await service.addFailedEvent(data);

      expect(mockQueueAdd).toHaveBeenCalledTimes(1);
      const [name, jobData, opts] = mockQueueAdd.mock.calls[0];
      expect(name).toBe('failed-event');
      expect(jobData.contractId).toBe(data.contractId);
      expect(jobData.ledger).toBe(data.ledger);
      expect(jobData.rawXdr).toBe(data.rawXdr);
      expect(opts.jobId).toMatch(new RegExp(`^${data.contractId}`));
    });

    it('should list jobs from the queue', async () => {
      const jobs = await service.listJobs('failed', 0, 9);
      expect(mockQueueGetJobs).toHaveBeenCalledWith(['failed'], 0, 9);
      expect(jobs).toHaveLength(1);
    });

    it('should re-drive a job by id', async () => {
      const result = await service.retryJob(mockJobId);
      expect(mockJobFromId).toHaveBeenCalled();
      expect(mockQueueAdd).toHaveBeenCalled();
      expect(result.queued).toBe(true);
      expect(result.newJobId).toBe(mockJobId);
    });

    it('should re-drive a job with patched data', async () => {
      const patch: Partial<DlqJobData> = { rawXdr: 'FIXED_XDR...' };
      const result = await service.retryJobWithData(mockJobId, patch);

      expect(result.queued).toBe(true);
      const [, jobData] = mockQueueAdd.mock.calls[0];
      expect(jobData.rawXdr).toBe('FIXED_XDR...');
      // original fields are preserved
      expect(jobData.contractId).toBe(mockJob.data.contractId);
    });

    it('should return queued=false when job id does not exist', async () => {
      mockJobFromId.mockResolvedValueOnce(null);
      const result = await service.retryJob('non-existent');
      expect(result.queued).toBe(false);
    });

    it('should use the INDEXER_DLQ_QUEUE constant as queue name', () => {
      expect(INDEXER_DLQ_QUEUE).toBe('indexer-dlq');
    });
  });

  // ── Discord webhook alert ────────────────────────────────────────────────

  describe('Discord webhook notification', () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });

    beforeEach(async () => {
      global.fetch = fetchMock;
      configService = {
        get: jest.fn().mockImplementation((key: string, defaultVal?: any) => {
          if (key === 'REDIS_URL') return 'redis://localhost:6379';
          if (key === 'DISCORD_ADMIN_WEBHOOK_URL') return 'https://discord.com/api/webhooks/test';
          if (key === 'INDEXER_DLQ_JOB_TTL_MS') return defaultVal ?? 604800000;
          return defaultVal;
        }),
      } as any;

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          IndexerDlqService,
          { provide: ConfigService, useValue: configService },
        ],
      }).compile();

      service = module.get<IndexerDlqService>(IndexerDlqService);
      service.onModuleInit();
    });

    it('should POST to Discord webhook when a job is parked', async () => {
      await service.addFailedEvent(makeSampleJob());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('https://discord.com/api/webhooks/test');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body as string);
      expect(body.content).toContain('DLQ Entry');
    });

    it('should not throw if Discord webhook request fails', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));
      await expect(service.addFailedEvent(makeSampleJob())).resolves.toBeUndefined();
    });
  });
});
