import { ConfigService } from '@nestjs/config';
import {
  DiskHealthIndicator,
  MemoryHealthIndicator,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { CacheHealthIndicator } from './indicators/cache.health-indicator';
import { RpcHealthIndicator } from './indicators/rpc.health-indicator';

function up(key: string, extra: Record<string, unknown> = {}) {
  return Promise.resolve({ [key]: { status: 'up', ...extra } });
}

function down(key: string, extra: Record<string, unknown> = {}) {
  return Promise.resolve({ [key]: { status: 'down', ...extra } });
}

describe('HealthController', () => {
  let controller: HealthController;
  let configService: { get: jest.Mock };
  let typeOrm: { pingCheck: jest.Mock };
  let memory: { checkHeap: jest.Mock };
  let disk: { checkStorage: jest.Mock };
  let cache: { pingCheck: jest.Mock };
  let rpc: { checkBase: jest.Mock; checkSoroban: jest.Mock };

  beforeEach(() => {
    configService = { get: jest.fn().mockReturnValue(1) };
    typeOrm = { pingCheck: jest.fn().mockReturnValue(up('database')) };
    memory = {
      checkHeap: jest.fn().mockResolvedValue({ memory_heap: { status: 'up' } }),
    };
    disk = { checkStorage: jest.fn().mockReturnValue(up('disk')) };
    cache = { pingCheck: jest.fn().mockReturnValue(up('cache')) };
    rpc = {
      checkBase: jest.fn().mockReturnValue(up('rpc_base')),
      checkSoroban: jest.fn().mockReturnValue(up('rpc_soroban')),
    };

    controller = new HealthController(
      configService as unknown as ConfigService,
      typeOrm as unknown as TypeOrmHealthIndicator,
      memory as unknown as MemoryHealthIndicator,
      disk as unknown as DiskHealthIndicator,
      cache as unknown as CacheHealthIndicator,
      rpc as unknown as RpcHealthIndicator,
    );
  });

  describe('liveness (GET /health)', () => {
    it('returns ok without touching any external dependency', async () => {
      const result = await controller.liveness();

      expect(result.status).toBe('ok');
      expect(typeOrm.pingCheck).not.toHaveBeenCalled();
      expect(cache.pingCheck).not.toHaveBeenCalled();
      expect(rpc.checkBase).not.toHaveBeenCalled();
    });
  });

  describe('readiness (GET /health/ready)', () => {
    it('reports ok when every dependency is up', async () => {
      const result = await controller.readiness();

      expect(result.status).toBe('ok');
      expect(Object.keys(result.info)).toEqual(
        expect.arrayContaining(['database', 'cache', 'rpc_base', 'rpc_soroban', 'disk']),
      );
    });

    it('reports error when the database (critical) is down', async () => {
      typeOrm.pingCheck.mockReturnValue(down('database', { message: 'no connection' }));
      const mockRes = { status: jest.fn() };

      const result = await controller.readiness(mockRes as any);

      expect(result.status).toBe('error');
      expect(result.details.database.status).toBe('down');
      expect(mockRes.status).toHaveBeenCalledWith(503);
    });

    it('reports degraded when non-critical dependencies fail within the threshold', async () => {
      cache.pingCheck.mockReturnValue(down('cache'));

      const result = await controller.readiness();

      expect(result.status).toBe('degraded');
      expect(result.details.cache.status).toBe('down');
      // Still-healthy dependencies remain reported.
      expect(result.details.database.status).toBe('up');
    });

    it('reports error when non-critical failures exceed the threshold', async () => {
      configService.get.mockReturnValue(1); // threshold = 1
      cache.pingCheck.mockReturnValue(down('cache'));
      rpc.checkBase.mockReturnValue(down('rpc_base'));
      const mockRes = { status: jest.fn() };

      const result = await controller.readiness(mockRes as any);

      expect(result.status).toBe('error');
      expect(mockRes.status).toHaveBeenCalledWith(503);
    });

    it('treats an indicator that throws as down rather than crashing the endpoint', async () => {
      rpc.checkSoroban.mockRejectedValue(new Error('boom'));

      const result = await controller.readiness();

      expect(result.details.rpc_soroban.status).toBe('down');
      expect(result.details.rpc_soroban.message).toBe('boom');
      // A single non-critical failure is still within the default threshold.
      expect(result.status).toBe('degraded');
    });
  });
});
