import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { User, ChainType } from '../users/user.entity';

export interface JwtPayload {
  sub: string;
  wallet: string;
  chain: ChainType;
  iat?: number;
  exp?: number;
}

@Injectable()
export class AuthService {
  // In-memory nonce store: wallet -> nonce (production should use Redis)
  private readonly nonceStore = new Map<string, string>();

  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private readonly jwtService: JwtService,
  ) {}

  async validateUser(
    wallet: string,
    chain: ChainType = 'base',
    referrerWallet?: string,
  ): Promise<User> {
    let user = await this.usersRepository.findOne({ where: { wallet } });
    if (!user) {
      const normalizedReferrer = referrerWallet?.trim();
      let referrer: User | null = null;

      if (normalizedReferrer && normalizedReferrer !== wallet) {
        referrer = await this.usersRepository.findOne({
          where: { wallet: normalizedReferrer },
          relations: ['referredBy'],
        });

        // Prevention of cyclic referrals (A refers B refers A)
        // If the referrer (A) was referred by the current user (B), then B cannot be referred by A.
        if (referrer && referrer.referredByWallet === wallet) {
          referrer = null;
        }
      }

      user = this.usersRepository.create({
        wallet,
        chain,
        referredByWallet: referrer?.wallet,
      });
      await this.usersRepository.save(user);
    } else if (user.chain !== chain) {
      // Update chain if user switches chains
      user.chain = chain;
      await this.usersRepository.save(user);
    }
    return user;
  }

  /**
   * Generates a cryptographically random nonce for the given wallet address
   * and stores it temporarily for later challenge verification.
   */
  generateNonce(wallet: string): string {
    const nonce = randomBytes(32).toString('hex');
    this.nonceStore.set(wallet.toLowerCase(), nonce);
    return nonce;
  }

  /**
   * Retrieves and clears (single-use) the stored nonce for a wallet.
   * Returns null if no nonce exists.
   */
  consumeNonce(wallet: string): string | null {
    const key = wallet.toLowerCase();
    const nonce = this.nonceStore.get(key) ?? null;
    if (nonce) {
      this.nonceStore.delete(key);
    }
    return nonce;
  }

  /**
   * Issues a signed JWT containing the wallet identity as the subject claim.
   */
  signJwt(user: User): string {
    const payload: JwtPayload = {
      sub: user.wallet,
      wallet: user.wallet,
      chain: user.chain,
    };
    return this.jwtService.sign(payload);
  }

  /**
   * Verifies a JWT and returns the decoded payload.
   * Throws UnauthorizedException for invalid or expired tokens.
   */
  verifyJwt(token: string): JwtPayload {
    try {
      return this.jwtService.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
