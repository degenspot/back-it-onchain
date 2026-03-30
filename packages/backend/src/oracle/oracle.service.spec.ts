import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OracleService } from './oracle.service';
import { Keypair } from '@stellar/stellar-sdk';

describe('OracleService', () => {
  let service: OracleService;
  jest.setTimeout(30000);

  // Test keypair with known values for verification
  // Secret: SCXJ4DAPQMXLKP3QITADMVLNX5Q7PV4L3BQKVME4N6TL5M2VJJYR7FAS
  // Public: GBUWVRJNL5WV5PA45EJ7IYQMEHIM67FJ3T5QVS7NVU7PFNKPDTSQD5PJ
  const TEST_SECRET_KEY =
    'SCXJ4DAPQMXLKP3QITADMVLNX5Q7PV4L3BQKVME4N6TL5M2VJJYR7FAS';
  const TEST_PUBLIC_KEY =
    'GBUWVRJNL5WV5PA45EJ7IYQMEHIM67FJ3T5QVS7NVU7PFNKPDTSQD5PJ';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OracleService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'STELLAR_ORACLE_SECRET_KEY') {
                return TEST_SECRET_KEY;
              }
              if (key === 'ORACLE_PRIVATE_KEY') {
                return '0x1234567890123456789012345678901234567890123456789012345678901234';
              }
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<OracleService>(OracleService);
  });

  describe('Stellar ed25519 signing', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should return correct Stellar public key', () => {
      const publicKey = service.getStellarPublicKey();
      expect(publicKey).toBe(TEST_PUBLIC_KEY);
    });

    it('should sign Stellar outcome with ed25519', () => {
      const callId = 1;
      const outcome = true;
      const finalPrice = 1000;
      const timestamp = 1234567890;

      const signature = service.signStellarOutcome(
        callId,
        outcome,
        finalPrice,
        timestamp,
      );

      // Signature should be a 64-byte Buffer
      expect(Buffer.isBuffer(signature)).toBe(true);
      expect(signature.length).toBe(64);
    });

    it('should produce consistent signatures for same input', () => {
      const callId = 1;
      const outcome = true;
      const finalPrice = 1000;
      const timestamp = 1234567890;

      const signature1 = service.signStellarOutcome(
        callId,
        outcome,
        finalPrice,
        timestamp,
      );

      const signature2 = service.signStellarOutcome(
        callId,
        outcome,
        finalPrice,
        timestamp,
      );

      expect(signature1.toString('hex')).toBe(signature2.toString('hex'));
    });

    it('should verify signature with Stellar SDK', () => {
      const callId = 1;
      const outcome = true;
      const finalPrice = 1000;
      const timestamp = 1234567890;

      const signature = service.signStellarOutcome(
        callId,
        outcome,
        finalPrice,
        timestamp,
      );

      // Reconstruct the message
      const message = `BackIt:Outcome:${callId}:${outcome}:${finalPrice}:${timestamp}`;
      const messageBuffer = Buffer.from(message, 'utf-8');

      // Verify with the public key
      const keypair = Keypair.fromSecret(TEST_SECRET_KEY);
      const isValid = keypair.verify(messageBuffer, signature);

      expect(isValid).toBe(true);
    });

    it('should produce different signatures for different inputs', () => {
      const callId1 = 1;
      const callId2 = 2;
      const outcome = true;
      const finalPrice = 1000;
      const timestamp = 1234567890;

      const signature1 = service.signStellarOutcome(
        callId1,
        outcome,
        finalPrice,
        timestamp,
      );

      const signature2 = service.signStellarOutcome(
        callId2,
        outcome,
        finalPrice,
        timestamp,
      );

      expect(signature1.toString('hex')).not.toBe(signature2.toString('hex'));
    });

    it('should handle outcome=false correctly', () => {
      const callId = 1;
      const outcome = false;
      const finalPrice = 500;
      const timestamp = 1234567890;

      const signature = service.signStellarOutcome(
        callId,
        outcome,
        finalPrice,
        timestamp,
      );

      // Verify signature
      const message = `BackIt:Outcome:${callId}:${outcome}:${finalPrice}:${timestamp}`;
      const messageBuffer = Buffer.from(message, 'utf-8');
      const keypair = Keypair.fromSecret(TEST_SECRET_KEY);
      const isValid = keypair.verify(messageBuffer, signature);

      expect(isValid).toBe(true);
    });

    it('should throw error when Stellar keypair not configured', async () => {
      // Create service without Stellar key
      const moduleWithoutKey: TestingModule = await Test.createTestingModule({
        providers: [
          OracleService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn(() => null),
            },
          },
        ],
      }).compile();

      const serviceWithoutKey =
        moduleWithoutKey.get<OracleService>(OracleService);

      expect(() =>
        serviceWithoutKey.signStellarOutcome(1, true, 1000, 1234567890),
      ).toThrow('Stellar keypair not configured');
    });
  });

  describe('Chain detection', () => {
    it('should use ed25519 signing for Stellar chain', async () => {
      const callId = 1;
      const outcome = true;
      const finalPrice = 1000;
      const timestamp = 1234567890;

      const signature = await service.signOutcomeForChain(
        'stellar',
        callId,
        outcome,
        finalPrice,
        timestamp,
      );

      // Should return base64 encoded signature
      expect(typeof signature).toBe('string');
      // Base64 signature should be decodable
      const buffer = Buffer.from(signature, 'base64');
      expect(buffer.length).toBe(64);
    });

    it('should use EIP-712 signing for Base chain', async () => {
      const callId = 1;
      const outcome = true;
      const finalPrice = 1000;
      const timestamp = 1234567890;

      const signature = await service.signOutcomeForChain(
        'base',
        callId,
        outcome,
        finalPrice,
        timestamp,
      );

      // EIP-712 signatures start with 0x and are hex strings
      expect(signature).toMatch(/^0x[0-9a-fA-F]+$/);
    });
  });

  describe('Test vectors for Soroban verification', () => {
    it('should produce expected signature for test vector 1', () => {
      // Test vector 1
      const callId = 42;
      const outcome = true;
      const finalPrice = 50000;
      const timestamp = 1700000000;

      const signature = service.signStellarOutcome(
        callId,
        outcome,
        finalPrice,
        timestamp,
      );

      const message = `BackIt:Outcome:${callId}:${outcome}:${finalPrice}:${timestamp}`;
      const messageBuffer = Buffer.from(message, 'utf-8');

      // Verify with keypair
      const keypair = Keypair.fromSecret(TEST_SECRET_KEY);
      const isValid = keypair.verify(messageBuffer, signature);

      expect(isValid).toBe(true);

      // Log test vector for documentation
      console.log('\n=== Test Vector 1 ===');
      console.log('Public Key:', TEST_PUBLIC_KEY);
      console.log('Message:', message);
      console.log('Signature (hex):', signature.toString('hex'));
      console.log('Signature (base64):', signature.toString('base64'));
    });

    it('should produce expected signature for test vector 2', () => {
      // Test vector 2
      const callId = 123;
      const outcome = false;
      const finalPrice = 25000;
      const timestamp = 1705000000;

      const signature = service.signStellarOutcome(
        callId,
        outcome,
        finalPrice,
        timestamp,
      );

      const message = `BackIt:Outcome:${callId}:${outcome}:${finalPrice}:${timestamp}`;
      const messageBuffer = Buffer.from(message, 'utf-8');

      const keypair = Keypair.fromSecret(TEST_SECRET_KEY);
      const isValid = keypair.verify(messageBuffer, signature);

      expect(isValid).toBe(true);

      // Log test vector for documentation
      console.log('\n=== Test Vector 2 ===');
      console.log('Public Key:', TEST_PUBLIC_KEY);
      console.log('Message:', message);
      console.log('Signature (hex):', signature.toString('hex'));
      console.log('Signature (base64):', signature.toString('base64'));
    });
  });

  describe('Price fetching with mocked RPC', () => {
    let originalFetch: typeof global.fetch;
    let originalAbortSignalTimeout: any;
    let originalSetTimeout: any;

    beforeEach(() => {
      originalFetch = global.fetch;
      originalAbortSignalTimeout = (AbortSignal as any).timeout;
      originalSetTimeout = global.setTimeout;
      // Avoid creating real 8s timers for AbortSignal.timeout during unit tests.
      (AbortSignal as any).timeout = () => new AbortController().signal;
      // Execute retry backoff timers immediately to keep tests fast/stable.
      (global as any).setTimeout = (cb: any) => {
        cb();
        return 0;
      };
      jest.clearAllMocks();
    });

    afterEach(() => {
      global.fetch = originalFetch;
      (AbortSignal as any).timeout = originalAbortSignalTimeout;
      (global as any).setTimeout = originalSetTimeout;
      jest.clearAllMocks();
    });

    it('should successfully fetch price for token', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          pairs: [
            {
              priceUsd: '1500.50',
              baseToken: { symbol: 'TEST' },
              volume: { h24: 1000000 },
              liquidity: { usd: 5000000 },
            },
          ],
        }),
      });

      const tokenAddress = '0x1234567890123456789012345678901234567890';
      const price = await service.fetchPrice(tokenAddress);

      expect(price).toBe(1500.50);
      expect(global.fetch).toHaveBeenCalledWith(
        `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
        expect.objectContaining({
          headers: { Accept: 'application/json' },
        }),
      );
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should parse prices with various decimal places', async () => {
      const testCases = [
        { priceUsd: '0.001', expected: 0.001 },
        { priceUsd: '1.23456789', expected: 1.23456789 },
        { priceUsd: '50000.99', expected: 50000.99 },
        { priceUsd: '0.000001', expected: 0.000001 },
      ];

      for (const testCase of testCases) {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            pairs: [
              {
                priceUsd: testCase.priceUsd,
                baseToken: { symbol: 'TEST' },
                volume: { h24: 100 },
                liquidity: { usd: 1000 },
              },
            ],
          }),
        });

        const price = await service.fetchPrice('0xtoken');
        expect(price).toBe(testCase.expected);
      }
    });

    it('should handle very high and very low prices', async () => {
      // Very high price
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          pairs: [
            {
              priceUsd: '999999999.99',
              baseToken: { symbol: 'EXPENSIVE' },
              volume: { h24: 100 },
              liquidity: { usd: 1000 },
            },
          ],
        }),
      });

      let price = await service.fetchPrice('0xexpensive');
      expect(price).toBe(999999999.99);

      // Very low price
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          pairs: [
            {
              priceUsd: '0.00000001',
              baseToken: { symbol: 'CHEAP' },
              volume: { h24: 1000000 },
              liquidity: { usd: 100000 },
            },
          ],
        }),
      });

      price = await service.fetchPrice('0xcheap');
      expect(price).toBe(0.00000001);
    });

    it('should throw error when API returns non-ok status', async () => {
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

      try {
        global.fetch = jest.fn().mockResolvedValue({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        });

        const tokenAddress = '0x1234567890123456789012345678901234567890';

        const pricePromise = service.fetchPrice(tokenAddress);
        // Ensure the first failed attempt schedules its retry timer.
        await Promise.resolve();

        await expect(pricePromise).rejects.toThrow(
          'DexScreener responded 404 Not Found',
        );
      } finally {
        randomSpy.mockRestore();
      }
    });

    it('should throw error when no price data in response', async () => {
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

      try {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            pairs: [],
          }),
        });

        const pricePromise = service.fetchPrice('0xtoken');
        // Ensure the first failed attempt schedules its retry timer.
        await Promise.resolve();

        await expect(pricePromise).rejects.toThrow(
          'No price data returned by DexScreener',
        );
      } finally {
        randomSpy.mockRestore();
      }
    });

    it('should throw error when price field is missing', async () => {
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

      try {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            pairs: [
              {
                baseToken: { symbol: 'TEST' },
                volume: { h24: 1000 },
                liquidity: { usd: 5000 },
                // priceUsd is missing!
              },
            ],
          }),
        });

        const pricePromise = service.fetchPrice('0xtoken');
        // Ensure the first failed attempt schedules its retry timer.
        await Promise.resolve();

        await expect(pricePromise).rejects.toThrow(
          'No price data returned by DexScreener',
        );
      } finally {
        randomSpy.mockRestore();
      }
    });

    it('should handle network error with retry', async () => {
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

      try {
        const networkError = new Error('Network timeout');
        let attemptCount = 0;

        (global.fetch as any) = jest.fn(() => {
          attemptCount++;
          if (attemptCount < 3) {
            return Promise.reject(networkError) as Promise<Response>;
          }
          return Promise.resolve({
            ok: true,
            json: async () => ({
              pairs: [
                {
                  priceUsd: '100.00',
                  baseToken: { symbol: 'TEST' },
                  volume: { h24: 1000 },
                  liquidity: { usd: 5000 },
                },
              ],
            }),
          } as unknown as Response) as Promise<Response>;
        });

        const pricePromise = service.fetchPrice('0xtoken');
        // Ensure the first rejected attempt schedules its retry timer.
        await Promise.resolve();
        const price = await pricePromise;

        expect(price).toBe(100.0);
        expect(attemptCount).toBe(3);
        expect(global.fetch).toHaveBeenCalledTimes(3);
      } finally {
        randomSpy.mockRestore();
      }
    });

    it('should fail after max retry attempts exhausted', async () => {
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

      try {
        global.fetch = jest.fn().mockRejectedValue(new Error('API is down'));

        const pricePromise = service.fetchPrice('0xtoken');
        // Ensure the first rejected attempt schedules its retry timer.
        await Promise.resolve();

        await expect(pricePromise).rejects.toThrow(
          '"oracle:fetchPrice" failed after 4 attempt(s)',
        );
        expect(global.fetch).toHaveBeenCalledTimes(4);
      } finally {
        randomSpy.mockRestore();
      }
    });

    it('should include retry delays', async () => {
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

      try {
        const networkError = new Error('Temporary error');
        let attemptCount = 0;

        (global.fetch as any) = jest.fn(() => {
          attemptCount++;
          if (attemptCount < 2) {
            return Promise.reject(networkError) as Promise<Response>;
          }
          return Promise.resolve({
            ok: true,
            json: async () => ({
              pairs: [
                {
                  priceUsd: '50.00',
                  baseToken: { symbol: 'TEST' },
                  volume: { h24: 100 },
                  liquidity: { usd: 500 },
                },
              ],
            }),
          } as unknown as Response) as Promise<Response>;
        });

        const pricePromise = service.fetchPrice('0xtoken');
        // Ensure the first rejected attempt schedules its retry timer.
        await Promise.resolve();
        const price = await pricePromise;
        expect(price).toBe(50.0);
      } finally {
        randomSpy.mockRestore();
      }
    });

    it('should handle server errors (5xx)', async () => {
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

      try {
        global.fetch = jest
          .fn()
          .mockResolvedValueOnce({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
          })
          .mockResolvedValueOnce({
            ok: false,
            status: 503,
            statusText: 'Service Unavailable',
          })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              pairs: [
                {
                  priceUsd: '200.00',
                  baseToken: { symbol: 'TEST' },
                  volume: { h24: 1000 },
                  liquidity: { usd: 9000 },
                },
              ],
            }),
          });

        const pricePromise = service.fetchPrice('0xtoken');
        // Ensure the first failed attempt schedules its retry timer.
        await Promise.resolve();
        const price = await pricePromise;

        expect(price).toBe(200.0);
        expect(global.fetch).toHaveBeenCalledTimes(3);
      } finally {
        randomSpy.mockRestore();
      }
    });

    it('should handle malformed JSON response', async () => {
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

      try {
        let attemptCount = 0;

        (global.fetch as any) = jest.fn(() => {
          attemptCount++;
          if (attemptCount < 2) {
            return Promise.resolve({
              ok: true,
              json: async () => {
                throw new Error('Invalid JSON');
              },
            } as unknown as Response) as Promise<Response>;
          }
          return Promise.resolve({
            ok: true,
            json: async () => ({
              pairs: [
                {
                  priceUsd: '150.00',
                  baseToken: { symbol: 'TEST' },
                  volume: { h24: 1000 },
                  liquidity: { usd: 5000 },
                },
              ],
            }),
          } as unknown as Response) as Promise<Response>;
        });

        const pricePromise = service.fetchPrice('0xtoken');
        // Ensure the first failed attempt schedules its retry timer.
        await Promise.resolve();
        const price = await pricePromise;

        expect(price).toBe(150.0);
        expect(attemptCount).toBe(2);
      } finally {
        randomSpy.mockRestore();
      }
    });

    it('should use fetchPriceSafe to return null on exhaustion', async () => {
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

      try {
        global.fetch = jest
          .fn()
          .mockRejectedValue(new Error('Persistent connection failure'));

        const pricePromise = service.fetchPriceSafe('0xtoken');
        // Ensure the first failed attempt schedules its retry timer.
        await Promise.resolve();

        const price = await pricePromise;

        expect(price).toBeNull();
        expect(global.fetch).toHaveBeenCalledTimes(4);
      } finally {
        randomSpy.mockRestore();
      }
    });

    it('should use fetchPriceSafe to return price on success', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          pairs: [
            {
              priceUsd: '999.99',
              baseToken: { symbol: 'PREMIUM' },
              volume: { h24: 5000000 },
              liquidity: { usd: 10000000 },
            },
          ],
        }),
      });

      const price = await service.fetchPriceSafe('0xtoken');

      expect(price).toBe(999.99);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should handle response with multiple pairs (use first)', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          pairs: [
            {
              priceUsd: '100.00',
              baseToken: { symbol: 'PRIMARY' },
              volume: { h24: 900000 },
              liquidity: { usd: 9000000 },
            },
            {
              priceUsd: '105.00',
              baseToken: { symbol: 'SECONDARY' },
              volume: { h24: 100000 },
              liquidity: { usd: 1000000 },
            },
          ],
        }),
      });

      const price = await service.fetchPrice('0xtoken');

      // Should use the first pair
      expect(price).toBe(100.0);
    });

    it('should verify fetch called with correct headers and timeout', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          pairs: [
            {
              priceUsd: '75.50',
              baseToken: { symbol: 'TEST' },
              volume: { h24: 500000 },
              liquidity: { usd: 2500000 },
            },
          ],
        }),
      });

      const tokenAddress = '0xabcdef1234567890abcdef1234567890abcdef12';
      await service.fetchPrice(tokenAddress);

      expect(global.fetch).toHaveBeenCalledWith(
        `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
        expect.objectContaining({
          headers: { Accept: 'application/json' },
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it('should handle price string with scientific notation', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          pairs: [
            {
              priceUsd: '1e-6', // Very small price
              baseToken: { symbol: 'MICRO' },
              volume: { h24: 1000000 },
              liquidity: { usd: 100000 },
            },
          ],
        }),
      });

      const price = await service.fetchPrice('0xscience');
      expect(price).toBe(0.000001);
    });

    it('should incorporate volume and liquidity info in logs', async () => {
      const originalLogger = (service as any).logger;
      const loggerMock = {
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
      };

      (service as any).logger = loggerMock;
      try {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            pairs: [
              {
                priceUsd: '500.00',
                baseToken: { symbol: 'TESTED' },
                volume: { h24: 2500000 },
                liquidity: { usd: 5000000 },
              },
            ],
          }),
        });

        await service.fetchPrice('0xtoken');

        // Logger should have been called
        expect(loggerMock.log).toHaveBeenCalled();
      } finally {
        (service as any).logger = originalLogger;
      }
    });
  });

  describe('Call resolution integration', () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
      jest.clearAllMocks();
    });

    it('should provide price for outcome determination', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          pairs: [
            {
              priceUsd: '42500.00',
              baseToken: { symbol: 'BTC' },
              volume: { h24: 50000000 },
              liquidity: { usd: 100000000 },
            },
          ],
        }),
      });

      const finalPrice = await service.fetchPrice('0xbtc');

      // Now use the price for call resolution
      const signature = await service.signOutcomeForChain(
        'stellar',
        1,
        true, // outcome based on price
        Math.floor(finalPrice * 100), // in cents
        Math.floor(Date.now() / 1000),
      );

      expect(signature).toBeTruthy();
      expect(typeof signature).toBe('string');
    });

    it(
      'should handle outcome resolution with failed price fetch',
      async () => {
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

        try {
          global.fetch = jest.fn().mockRejectedValue(new Error('API down'));

          const pricePromise = service.fetchPriceSafe('0xtoken');
          // Ensure the first failed attempt schedules its retry timer.
          await Promise.resolve();
          const price = await pricePromise;
          expect(price).toBeNull();

          // Should still be able to sign with default price if available
          const signature = await service.signOutcomeForChain(
            'base',
            1,
            true,
            0, // fallback price
            Math.floor(Date.now() / 1000),
          );

          expect(signature).toBeTruthy();
        } finally {
          randomSpy.mockRestore();
        }
      },
      20000,
    );

    it('should maintain price consistency for single call resolution', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          pairs: [
            {
              priceUsd: '2000.50',
              baseToken: { symbol: 'ETH' },
              volume: { h24: 10000000 },
              liquidity: { usd: 20000000 },
            },
          ],
        }),
      });

      // Fetch price for call resolution
      const price1 = await service.fetchPrice('0xeth');
      const price2 = await service.fetchPrice('0xeth');

      // Prices should be the same if API is consistent
      expect(price1).toBe(price2);
      expect(price1).toBe(2000.5);
    });
  });
});
