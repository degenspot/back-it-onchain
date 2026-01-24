import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OracleService } from './oracle.service';
import { Keypair } from '@stellar/stellar-sdk';

describe('OracleService', () => {
  let service: OracleService;
  let configService: ConfigService;

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
    configService = module.get<ConfigService>(ConfigService);
  });

  describe('Stellar ed25519 signing', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should return correct Stellar public key', () => {
      const publicKey = service.getStellarPublicKey();
      expect(publicKey).toBe(TEST_PUBLIC_KEY);
    });

    it('should sign Stellar outcome with ed25519', async () => {
      const callId = 1;
      const outcome = true;
      const finalPrice = 1000;
      const timestamp = 1234567890;

      const signature = await service.signStellarOutcome(
        callId,
        outcome,
        finalPrice,
        timestamp,
      );

      // Signature should be a 64-byte Buffer
      expect(Buffer.isBuffer(signature)).toBe(true);
      expect(signature.length).toBe(64);
    });

    it('should produce consistent signatures for same input', async () => {
      const callId = 1;
      const outcome = true;
      const finalPrice = 1000;
      const timestamp = 1234567890;

      const signature1 = await service.signStellarOutcome(
        callId,
        outcome,
        finalPrice,
        timestamp,
      );

      const signature2 = await service.signStellarOutcome(
        callId,
        outcome,
        finalPrice,
        timestamp,
      );

      expect(signature1.toString('hex')).toBe(signature2.toString('hex'));
    });

    it('should verify signature with Stellar SDK', async () => {
      const callId = 1;
      const outcome = true;
      const finalPrice = 1000;
      const timestamp = 1234567890;

      const signature = await service.signStellarOutcome(
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

    it('should produce different signatures for different inputs', async () => {
      const callId1 = 1;
      const callId2 = 2;
      const outcome = true;
      const finalPrice = 1000;
      const timestamp = 1234567890;

      const signature1 = await service.signStellarOutcome(
        callId1,
        outcome,
        finalPrice,
        timestamp,
      );

      const signature2 = await service.signStellarOutcome(
        callId2,
        outcome,
        finalPrice,
        timestamp,
      );

      expect(signature1.toString('hex')).not.toBe(signature2.toString('hex'));
    });

    it('should handle outcome=false correctly', async () => {
      const callId = 1;
      const outcome = false;
      const finalPrice = 500;
      const timestamp = 1234567890;

      const signature = await service.signStellarOutcome(
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

      await expect(
        serviceWithoutKey.signStellarOutcome(1, true, 1000, 1234567890),
      ).rejects.toThrow('Stellar keypair not configured');
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
    it('should produce expected signature for test vector 1', async () => {
      // Test vector 1
      const callId = 42;
      const outcome = true;
      const finalPrice = 50000;
      const timestamp = 1700000000;

      const signature = await service.signStellarOutcome(
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

    it('should produce expected signature for test vector 2', async () => {
      // Test vector 2
      const callId = 123;
      const outcome = false;
      const finalPrice = 25000;
      const timestamp = 1705000000;

      const signature = await service.signStellarOutcome(
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

  describe('Price fetching', () => {
    it('should fetch price for token', async () => {
      const tokenAddress = '0x1234567890123456789012345678901234567890';
      const price = await service.fetchPrice(tokenAddress);

      expect(typeof price).toBe('number');
      expect(price).toBeGreaterThan(0);
    });
  });
});
