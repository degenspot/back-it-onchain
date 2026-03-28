import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { User, ChainType } from '../users/user.entity';
import { ethers } from 'ethers';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import nacl from 'tweetnacl';

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

  /**
   * Builds the standard sign-in challenge message that the client must sign.
   * Using a consistent format prevents signature replay across different apps.
   */
  buildSignMessage(address: string, nonce: string): string {
    return `Sign in to Back It Onchain\nAddress: ${address}\nNonce: ${nonce}`;
  }

  /**
   * Verifies an EIP-191 personal_sign signature (Base / EVM chains).
   * Returns true when the recovered signer matches the claimed address.
   */
  verifyEip191Signature(address: string, message: string, signature: string): boolean {
    try {
      const recovered = ethers.verifyMessage(message, signature);
      return recovered.toLowerCase() === address.toLowerCase();
    } catch {
      return false;
    }
  }

  /**
   * Verifies a raw ed25519 signature for a Stellar address.
   *
   * The client signs the UTF-8 encoded challenge message with its secret key
   * and submits the signature as a hex string.  We derive the public key from
   * the Stellar G… address and verify with tweetnacl.
   */
  verifyStellarSignature(address: string, message: string, signatureHex: string): boolean {
    try {
      // Validate that the address is a valid Stellar public key (G… address)
      if (!StrKey.isValidEd25519PublicKey(address)) {
        return false;
      }

      const keypair = Keypair.fromPublicKey(address);
      const publicKeyBytes = keypair.rawPublicKey(); // 32-byte Uint8Array

      const messageBytes = Buffer.from(message, 'utf8');
      const signatureBytes = Buffer.from(signatureHex, 'hex');

      return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
    } catch {
      return false;
    }
  }

  /**
   * Full verify-and-login flow:
   *   1. Consumes the single-use nonce for the address.
   *   2. Verifies the cryptographic signature.
   *   3. Upserts the user record.
   *   4. Returns a signed JWT.
   */
  async verifySignatureAndLogin(
    address: string,
    signature: string,
    chain: ChainType,
    referrerWallet?: string,
  ): Promise<string> {
    const nonce = this.consumeNonce(address);
    if (!nonce) {
      throw new UnauthorizedException('No pending nonce for this address — request a new one');
    }

    const message = this.buildSignMessage(address, nonce);

    let valid: boolean;
    if (chain === 'stellar') {
      valid = this.verifyStellarSignature(address, message, signature);
    } else {
      // Covers 'base' and any future EVM chains
      valid = this.verifyEip191Signature(address, message, signature);
    }

    if (!valid) {
      throw new UnauthorizedException('Signature verification failed');
    }

    const user = await this.validateUser(address, chain, referrerWallet);
    return this.signJwt(user);
  }
}
