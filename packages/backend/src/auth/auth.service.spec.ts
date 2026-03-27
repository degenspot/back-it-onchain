import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UnauthorizedException } from '@nestjs/common';

import { AuthService, JwtPayload } from './auth.service';
import { User, ChainType } from '../users/user.entity';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEST_JWT_SECRET = 'test-secret-key';

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.wallet = '0xTestWallet';
  user.chain = 'base';
  user.reputationScore = 100;
  Object.assign(user, overrides);
  return user;
}

function mockRepository(): jest.Mocked<Partial<Repository<User>>> {
  return {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;
  let usersRepo: jest.Mocked<Partial<Repository<User>>>;

  beforeEach(async () => {
    usersRepo = mockRepository();

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: TEST_JWT_SECRET,
          signOptions: { expiresIn: '1h' },
        }),
      ],
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(User),
          useValue: usersRepo,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);
  });

  // ── Nonce generation ────────────────────────────────────────────────────────

  describe('generateNonce', () => {
    it('should return a 64-character hex string', () => {
      const nonce = service.generateNonce('0xabc');
      expect(nonce).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should return a unique nonce on every call for the same wallet', () => {
      const first = service.generateNonce('0xabc');
      const second = service.generateNonce('0xabc');
      expect(first).not.toBe(second);
    });

    it('should produce different nonces for different wallets', () => {
      const a = service.generateNonce('0xaaa');
      const b = service.generateNonce('0xbbb');
      expect(a).not.toBe(b);
    });

    it('should store the nonce so it can be consumed afterwards', () => {
      const nonce = service.generateNonce('0xstore');
      const consumed = service.consumeNonce('0xstore');
      expect(consumed).toBe(nonce);
    });
  });

  // ── Nonce challenge (consume) ───────────────────────────────────────────────

  describe('consumeNonce', () => {
    it('should return null when no nonce has been generated for a wallet', () => {
      expect(service.consumeNonce('0xunknown')).toBeNull();
    });

    it('should return the previously generated nonce', () => {
      const nonce = service.generateNonce('0xconsume');
      expect(service.consumeNonce('0xconsume')).toBe(nonce);
    });

    it('should invalidate the nonce after first consumption (single-use)', () => {
      service.generateNonce('0xonce');
      service.consumeNonce('0xonce'); // first use
      expect(service.consumeNonce('0xonce')).toBeNull(); // second use → gone
    });

    it('should be case-insensitive for wallet addresses', () => {
      const nonce = service.generateNonce('0xMixed');
      // Access via fully-uppercase address should still resolve
      expect(service.consumeNonce('0XMIXED')).toBe(nonce);
    });
  });

  // ── JWT generation ──────────────────────────────────────────────────────────

  describe('signJwt', () => {
    it('should return a non-empty JWT string', () => {
      const user = buildUser();
      const token = service.signJwt(user);
      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3); // header.payload.signature
    });

    it('should embed the wallet address as the "sub" claim', () => {
      const user = buildUser({ wallet: '0xDeadBeef' });
      const token = service.signJwt(user);
      const decoded = jwtService.decode(token) as JwtPayload;
      expect(decoded.sub).toBe('0xDeadBeef');
    });

    it('should embed the wallet address in the "wallet" claim', () => {
      const user = buildUser({ wallet: '0xDeadBeef' });
      const token = service.signJwt(user);
      const decoded = jwtService.decode(token) as JwtPayload;
      expect(decoded.wallet).toBe('0xDeadBeef');
    });

    it('should embed the chain in the "chain" claim', () => {
      const baseUser = buildUser({ chain: 'base' });
      const stellarUser = buildUser({ chain: 'stellar' });

      const baseToken = service.signJwt(baseUser);
      const stellarToken = service.signJwt(stellarUser);

      expect((jwtService.decode(baseToken) as JwtPayload).chain).toBe('base');
      expect((jwtService.decode(stellarToken) as JwtPayload).chain).toBe('stellar');
    });

    it('should include iat and exp claims', () => {
      const user = buildUser();
      const token = service.signJwt(user);
      const decoded = jwtService.decode(token) as JwtPayload;
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
      expect(decoded.exp).toBeGreaterThan(decoded.iat!);
    });

    it('should produce different tokens for different users', () => {
      const alice = buildUser({ wallet: '0xAlice' });
      const bob = buildUser({ wallet: '0xBob' });
      expect(service.signJwt(alice)).not.toBe(service.signJwt(bob));
    });
  });

  // ── JWT verification ────────────────────────────────────────────────────────

  describe('verifyJwt', () => {
    it('should successfully verify a token signed by signJwt', () => {
      const user = buildUser({ wallet: '0xVerify' });
      const token = service.signJwt(user);
      const payload = service.verifyJwt(token);
      expect(payload.wallet).toBe('0xVerify');
      expect(payload.sub).toBe('0xVerify');
    });

    it('should return the chain claim from a verified token', () => {
      const user = buildUser({ wallet: '0xChain', chain: 'stellar' });
      const token = service.signJwt(user);
      const payload = service.verifyJwt(token);
      expect(payload.chain).toBe('stellar');
    });

    it('should throw UnauthorizedException for a tampered token', () => {
      const user = buildUser();
      const token = service.signJwt(user);
      const tampered = token.slice(0, -5) + 'XXXXX'; // corrupt the signature
      expect(() => service.verifyJwt(tampered)).toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for a completely invalid token', () => {
      expect(() => service.verifyJwt('not.a.jwt')).toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for an expired token', async () => {
      // Build a service with a 1-second expiry JWT module
      const shortLivedModule: TestingModule = await Test.createTestingModule({
        imports: [
          JwtModule.register({
            secret: TEST_JWT_SECRET,
            signOptions: { expiresIn: '1s' },
          }),
        ],
        providers: [
          AuthService,
          { provide: getRepositoryToken(User), useValue: usersRepo },
        ],
      }).compile();

      const shortService = shortLivedModule.get<AuthService>(AuthService);
      const token = shortService.signJwt(buildUser());

      // Wait for the token to expire
      await new Promise((resolve) => setTimeout(resolve, 1500));

      expect(() => shortService.verifyJwt(token)).toThrow(UnauthorizedException);
    });
  });

  // ── validateUser ────────────────────────────────────────────────────────────

  describe('validateUser', () => {
    it('should return an existing user without creating a new one', async () => {
      const existing = buildUser({ wallet: '0xExists' });
      (usersRepo.findOne as jest.Mock).mockResolvedValue(existing);

      const result = await service.validateUser('0xExists', 'base');
      expect(result).toBe(existing);
      expect(usersRepo.create).not.toHaveBeenCalled();
    });

    it('should create and save a new user when wallet is not found', async () => {
      const newUser = buildUser({ wallet: '0xNew' });
      (usersRepo.findOne as jest.Mock).mockResolvedValue(null);
      (usersRepo.create as jest.Mock).mockReturnValue(newUser);
      (usersRepo.save as jest.Mock).mockResolvedValue(newUser);

      const result = await service.validateUser('0xNew', 'base');
      expect(usersRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ wallet: '0xNew', chain: 'base' }),
      );
      expect(usersRepo.save).toHaveBeenCalledWith(newUser);
      expect(result).toBe(newUser);
    });

    it('should update the chain when an existing user switches chains', async () => {
      const existing = buildUser({ wallet: '0xSwitch', chain: 'base' });
      (usersRepo.findOne as jest.Mock).mockResolvedValue(existing);
      (usersRepo.save as jest.Mock).mockResolvedValue({ ...existing, chain: 'stellar' });

      const result = await service.validateUser('0xSwitch', 'stellar');
      expect(usersRepo.save).toHaveBeenCalled();
      expect(result.chain).toBe('stellar');
    });

    it('should not attach a referrer that would create a cyclic referral', async () => {
      const wallet = '0xA';
      const referrerWallet = '0xB';

      // 0xB was referred by 0xA → assigning 0xB as referrer for 0xA is cyclic
      const referrer = buildUser({ wallet: referrerWallet, referredByWallet: wallet });
      const createdUser = buildUser({ wallet });

      (usersRepo.findOne as jest.Mock)
        .mockResolvedValueOnce(null)      // user not found
        .mockResolvedValueOnce(referrer); // referrer found
      (usersRepo.create as jest.Mock).mockReturnValue(createdUser);
      (usersRepo.save as jest.Mock).mockResolvedValue(createdUser);

      await service.validateUser(wallet, 'base', referrerWallet);
      expect(usersRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ referredByWallet: undefined }),
      );
    });

    it('should default the chain to "base" when no chain is specified', async () => {
      const newUser = buildUser({ wallet: '0xDefault', chain: 'base' });
      (usersRepo.findOne as jest.Mock).mockResolvedValue(null);
      (usersRepo.create as jest.Mock).mockReturnValue(newUser);
      (usersRepo.save as jest.Mock).mockResolvedValue(newUser);

      await service.validateUser('0xDefault');
      expect(usersRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ chain: 'base' }),
      );
    });
  });
});
