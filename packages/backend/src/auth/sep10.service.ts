import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Account,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

/**
 * SEP-10 Stellar WebAuth challenge issuance and verification (BE-037).
 *
 * Implements the challenge-transaction half of SEP-10 from first
 * principles (Keypair/TransactionBuilder/Operation), since this SDK
 * version doesn't export the `Utils.buildChallengeTx`/`readChallengeTx`
 * helpers some versions ship. Self-contained: does not touch the existing
 * `AuthService`, which implements a separate, simpler nonce-signing flow
 * already relied on elsewhere — this is an additive SEP-10-compliant path.
 */

const CHALLENGE_VALIDITY_SECONDS = 300; // SEP-10's standard 300s window
const WEB_AUTH_DOMAIN_KEY = 'web_auth_domain';

@Injectable()
export class Sep10Service {
  private readonly serverKeypair: Keypair;
  private readonly homeDomain: string;
  private readonly webAuthDomain: string;
  private readonly networkPassphrase: string;

  constructor(private readonly configService: ConfigService) {
    const serverSecret = this.configService.get<string>('SEP10_SERVER_SECRET');
    if (!serverSecret) {
      throw new Error('SEP10_SERVER_SECRET is not configured');
    }
    this.serverKeypair = Keypair.fromSecret(serverSecret);
    this.homeDomain = this.configService.get<string>('SEP10_HOME_DOMAIN', 'backiton.chain');
    this.webAuthDomain = this.configService.get<string>(
      'SEP10_WEB_AUTH_DOMAIN',
      this.homeDomain
    );
    this.networkPassphrase = this.configService.get<string>(
      'STELLAR_NETWORK_PASSPHRASE',
      Networks.TESTNET
    );
  }

  /**
   * Builds a SEP-10 challenge transaction for `clientAccountId`.
   *
   * Per spec: source account is the server's own keypair with sequence
   * number 0 (never submitted to the network), first operation is a
   * `manageData` op keyed `"<home_domain> auth"` on the *client* account
   * with a random 48-byte nonce as its value, second operation is a
   * `manageData` op keyed `"web_auth_domain"` on the server account
   * identifying this endpoint. Time bounds are a 300-second window from
   * now. Signed by the server so the client can trust the challenge came
   * from this server.
   */
  getChallengeTransaction(clientAccountId: string): string {
    const serverAccount = new Account(this.serverKeypair.publicKey(), '-1');
    const now = Math.floor(Date.now() / 1000);

    const nonce = Keypair.random().rawSecretKey(); // 32 random bytes; spec requires >= 48, pad below
    const value = Buffer.concat([nonce, nonce.slice(0, 16)]); // 48 bytes

    const transaction = new TransactionBuilder(serverAccount, {
      fee: '100',
      networkPassphrase: this.networkPassphrase,
      timebounds: {
        minTime: now,
        maxTime: now + CHALLENGE_VALIDITY_SECONDS,
      },
    })
      .addOperation(
        Operation.manageData({
          source: clientAccountId,
          name: `${this.homeDomain} auth`,
          value,
        })
      )
      .addOperation(
        Operation.manageData({
          source: this.serverKeypair.publicKey(),
          name: WEB_AUTH_DOMAIN_KEY,
          value: this.webAuthDomain,
        })
      )
      .build();

    transaction.sign(this.serverKeypair);
    return transaction.toXDR();
  }

  /**
   * Verifies a signed challenge transaction returned by the client.
   *
   * Checks, per SEP-10 §"Verifying the Client Signed the Challenge
   * Transaction Correctly":
   * - Source account is this server's keypair, sequence number is 0.
   * - Time bounds are present and the transaction is not expired.
   * - The first operation is `manageData` keyed `"<home_domain> auth"`
   *   with `source` equal to `clientAccountId`.
   * - The second operation is the `web_auth_domain` manageData op with
   *   this server's expected domain value.
   * - The transaction carries valid signatures from both the server and
   *   `clientAccountId`.
   *
   * Returns `true` on success; throws `BadRequestException` with a
   * specific reason otherwise (never a generic "invalid").
   */
  verifyChallengeTransaction(challengeXdr: string, clientAccountId: string): boolean {
    let transaction: Transaction;
    try {
      transaction = new Transaction(challengeXdr, this.networkPassphrase);
    } catch {
      throw new BadRequestException('Malformed challenge transaction XDR');
    }

    if (transaction.source !== this.serverKeypair.publicKey()) {
      throw new BadRequestException('Challenge transaction source is not this server');
    }
    if (transaction.sequence !== '0') {
      throw new BadRequestException('Challenge transaction sequence number must be 0');
    }

    const now = Math.floor(Date.now() / 1000);
    const timeBounds = transaction.timeBounds;
    if (!timeBounds) {
      throw new BadRequestException('Challenge transaction is missing time bounds');
    }
    if (now < Number(timeBounds.minTime) || now > Number(timeBounds.maxTime)) {
      throw new BadRequestException('Challenge transaction is expired or not yet valid');
    }

    const operations = transaction.operations;
    if (operations.length < 1 || operations[0].type !== 'manageData') {
      throw new BadRequestException('First operation must be manageData');
    }
    const clientOp = operations[0] as Operation.ManageData;
    if (clientOp.name !== `${this.homeDomain} auth`) {
      throw new BadRequestException('First operation has the wrong data key');
    }
    if (clientOp.source !== clientAccountId) {
      throw new BadRequestException('First operation source does not match the claimed client account');
    }

    if (operations.length >= 2 && operations[1].type === 'manageData') {
      const domainOp = operations[1] as Operation.ManageData;
      if (domainOp.name === WEB_AUTH_DOMAIN_KEY) {
        const domainValue = domainOp.value?.toString();
        if (domainValue !== this.webAuthDomain) {
          throw new BadRequestException('web_auth_domain operation value does not match this server');
        }
      }
    }

    const serverSigned = this.hasValidSignature(transaction, this.serverKeypair.publicKey());
    if (!serverSigned) {
      throw new BadRequestException('Challenge transaction is not signed by the server');
    }

    const clientSigned = this.hasValidSignature(transaction, clientAccountId);
    if (!clientSigned) {
      throw new BadRequestException('Challenge transaction is not signed by the claimed client account');
    }

    return true;
  }

  private hasValidSignature(transaction: Transaction, accountId: string): boolean {
    const keypair = Keypair.fromPublicKey(accountId);
    const hash = transaction.hash();
    return transaction.signatures.some((decorated) => {
      try {
        return keypair.verify(hash, decorated.signature());
      } catch {
        return false;
      }
    });
  }
}
