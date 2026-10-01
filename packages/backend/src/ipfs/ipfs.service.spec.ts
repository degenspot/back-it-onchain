import { ConfigService } from '@nestjs/config';
import { IpfsService } from './ipfs.service';
import { canonicalizeJson, computeCidV1 } from '../common/ipfs/cid.util';

const configWith = (values: Record<string, string | undefined>): ConfigService =>
  ({
    get: (key: string, def?: unknown) => (key in values ? values[key] : def),
  }) as unknown as ConfigService;

describe('IpfsService (BE-016 JSON sealing)', () => {
  const originalFetch = global.fetch;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.NODE_ENV = originalNodeEnv;
    jest.restoreAllMocks();
  });

  const build = (values: Record<string, string | undefined> = {}) =>
    new IpfsService(
      configWith({ NODE_ENV: 'test', IPFS_API_URL: 'http://ipfs.local:5001', ...values }),
    );

  describe('pinJson()', () => {
    it('returns a deterministic CIDv1 derived from the canonical bytes', async () => {
      const service = build();
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ Hash: 'bafkreiprovidercid' }),
      }) as unknown as typeof fetch;

      const result = await service.pinJson({ hello: 'world' }, 'evidence.json');

      expect(result.cid).toBe('bafkreietui4xdkiu4xvmx4fi2jivjtndbhb4drzpxomrjvd4mdz4w2avra');
      expect(result.digest).toBe(
        '93a23971a914e5eacbf0a8d25154cda309c3c1c72fbb9914d47c60f3cb681588',
      );
      expect(result.size).toBe(canonicalizeJson({ hello: 'world' }).length);
      expect(result.pinned).toBe(true);
      expect(result.provider).toBe('kubo');
      expect(result.providerCid).toBe('bafkreiprovidercid');
    });

    it('is order-insensitive: a differently ordered document yields the same CID', async () => {
      const service = build();
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ Hash: 'bafkreiprovidercid' }),
      }) as unknown as typeof fetch;

      const one = await service.pinJson({ b: 2, a: 1 });
      const two = await service.pinJson({ a: 1, b: 2 });

      expect(one.cid).toBe(two.cid);
      expect(one.cid).toBe(computeCidV1(Buffer.from('{"a":1,"b":2}', 'utf8')));
    });

    it('still returns the deterministic CID when no provider is reachable (dev)', async () => {
      const service = build();
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;

      const result = await service.pinJson({ hello: 'world' });

      expect(result.cid).toBe('bafkreietui4xdkiu4xvmx4fi2jivjtndbhb4drzpxomrjvd4mdz4w2avra');
      expect(result.pinned).toBe(false);
      expect(result.provider).toBeUndefined();
    });

    it('fails closed in production when nothing accepted the pin', async () => {
      process.env.NODE_ENV = 'production';
      const service = build({ NODE_ENV: 'production' });
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;

      await expect(service.pinJson({ hello: 'world' })).rejects.toThrow(
        /no reachable IPFS backend configured/,
      );
    });

    it('logs but keeps the deterministic CID when the provider reports a different one', async () => {
      const service = build();
      const warn = jest
        .spyOn(
          (service as unknown as { logger: { warn: (...a: unknown[]) => void } }).logger,
          'warn',
        )
        .mockImplementation(() => undefined);
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ Hash: 'QmDifferentProviderCid' }),
      }) as unknown as typeof fetch;

      const result = await service.pinJson({ hello: 'world' });

      expect(result.cid).toBe('bafkreietui4xdkiu4xvmx4fi2jivjtndbhb4drzpxomrjvd4mdz4w2avra');
      expect(result.providerCid).toBe('QmDifferentProviderCid');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('keeping the deterministic CID'));
    });

    it('refuses a document whose canonical form is not stable', async () => {
      const service = build();
      global.fetch = jest.fn() as unknown as typeof fetch;

      await expect(service.pinJson({ a: Number.NaN })).rejects.toThrow(/non-finite/);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('pins to Kubo with cid-version=1 and raw-leaves=true so the CID matches', async () => {
      const service = build();
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ Hash: 'bafkrei...' }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      await service.pinJson({ hello: 'world' });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v0/add?pin=true&cid-version=1&raw-leaves=true'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('gateways', () => {
    it('defaults to the public fallback gateways, primary first', () => {
      const service = build();
      expect(service.getGatewayTemplates()).toEqual([
        'https://gateway.pinata.cloud/ipfs/{cid}',
        'https://ipfs.io/ipfs/{cid}',
        'https://dweb.link/ipfs/{cid}',
      ]);
      expect(service.gatewayUrl('bafkreiabc')).toBe('https://gateway.pinata.cloud/ipfs/bafkreiabc');
      expect(service.gatewayUrls('bafkreiabc')).toHaveLength(3);
    });

    it('honours IPFS_GATEWAYS and appends the canonical path when {cid} is absent', () => {
      const service = build({
        IPFS_GATEWAYS: 'https://my.gateway, https://other.gateway/{cid}',
      });
      expect(service.gatewayUrls('bafkreiabc')).toEqual([
        'https://my.gateway/ipfs/bafkreiabc',
        'https://other.gateway/bafkreiabc',
      ]);
    });
  });

  describe('validatePinning()', () => {
    it('reports the local node pin and stops at the first reachable gateway', async () => {
      const service = build();
      const fetchMock = jest
        .fn()
        // Kubo pin/ls
        .mockResolvedValueOnce({ ok: true, status: 200 })
        // primary gateway probe
        .mockResolvedValueOnce({ ok: false, status: 502 })
        // fallback gateway probe
        .mockResolvedValueOnce({ ok: true, status: 200 });
      global.fetch = fetchMock as unknown as typeof fetch;

      const status = await service.validatePinning('bafkreiabc');

      expect(status.pinned).toBe(true);
      expect(status.provider).toBe('kubo');
      expect(status.gateways).toEqual([
        {
          url: 'https://gateway.pinata.cloud/ipfs/bafkreiabc',
          reachable: false,
          status: 502,
        },
        { url: 'https://ipfs.io/ipfs/bafkreiabc', reachable: true, status: 200 },
      ]);
      expect(status.firstReachableGateway).toBe('https://ipfs.io/ipfs/bafkreiabc');
      // Third gateway is never probed once one answered.
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('reports pinned=false instead of throwing when everything is unreachable', async () => {
      const service = build();
      global.fetch = jest.fn().mockRejectedValue(new Error('ENOTFOUND')) as unknown as typeof fetch;

      const status = await service.validatePinning('bafkreiabc');

      expect(status.pinned).toBe(false);
      expect(status.provider).toBeUndefined();
      expect(status.firstReachableGateway).toBeUndefined();
      expect(status.gateways).toHaveLength(3);
      expect(status.gateways.every((g) => !g.reachable)).toBe(true);
    });
  });
});
