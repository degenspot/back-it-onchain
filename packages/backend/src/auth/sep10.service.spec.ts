import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Keypair } from '@stellar/stellar-sdk';
import { Sep10Service } from './sep10.service';

describe('Sep10Service', () => {
  const serverKeypair = Keypair.random();

  async function buildService(overrides: Record<string, unknown> = {}): Promise<Sep10Service> {
    const config: Record<string, unknown> = {
      SEP10_SERVER_SECRET: serverKeypair.secret(),
      SEP10_HOME_DOMAIN: 'backiton.chain',
      SEP10_WEB_AUTH_DOMAIN: 'backiton.chain',
      STELLAR_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
      ...overrides,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Sep10Service,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultValue?: unknown) => config[key] ?? defaultValue,
          },
        },
      ],
    }).compile();

    return module.get<Sep10Service>(Sep10Service);
  }

  it('should be defined', async () => {
    const service = await buildService();
    expect(service).toBeDefined();
  });

  it('issues a challenge transaction signed by the server', async () => {
    const service = await buildService();
    const client = Keypair.random();

    const xdr = service.getChallengeTransaction(client.publicKey());
    expect(typeof xdr).toBe('string');
    expect(xdr.length).toBeGreaterThan(0);
  });

  it('verifies a challenge transaction correctly signed by client and server', async () => {
    const service = await buildService();
    const client = Keypair.random();

    const xdr = service.getChallengeTransaction(client.publicKey());

    // Simulate the client signing the challenge and returning it.
    const { Transaction } = await import('@stellar/stellar-sdk');
    const transaction = new Transaction(xdr, 'Test SDF Network ; September 2015');
    transaction.sign(client);
    const signedXdr = transaction.toXDR();

    expect(service.verifyChallengeTransaction(signedXdr, client.publicKey())).toBe(true);
  });

  it('rejects a challenge missing the client signature', async () => {
    const service = await buildService();
    const client = Keypair.random();

    const xdr = service.getChallengeTransaction(client.publicKey());
    // Not signed by the client — only the server's signature is present.

    expect(() => service.verifyChallengeTransaction(xdr, client.publicKey())).toThrow(
      'not signed by the claimed client account'
    );
  });

  it('rejects a challenge claiming the wrong client account', async () => {
    const service = await buildService();
    const client = Keypair.random();
    const impostor = Keypair.random();

    const xdr = service.getChallengeTransaction(client.publicKey());
    const { Transaction } = await import('@stellar/stellar-sdk');
    const transaction = new Transaction(xdr, 'Test SDF Network ; September 2015');
    transaction.sign(client);
    const signedXdr = transaction.toXDR();

    expect(() => service.verifyChallengeTransaction(signedXdr, impostor.publicKey())).toThrow(
      'does not match the claimed client account'
    );
  });

  it('rejects a malformed XDR string', async () => {
    const service = await buildService();
    const client = Keypair.random();

    expect(() => service.verifyChallengeTransaction('not-valid-xdr', client.publicKey())).toThrow(
      'Malformed challenge transaction XDR'
    );
  });

  it('rejects an expired challenge transaction', async () => {
    jest.useFakeTimers();
    const service = await buildService();
    const client = Keypair.random();

    const xdr = service.getChallengeTransaction(client.publicKey());
    const { Transaction } = await import('@stellar/stellar-sdk');
    const transaction = new Transaction(xdr, 'Test SDF Network ; September 2015');
    transaction.sign(client);
    const signedXdr = transaction.toXDR();

    jest.setSystemTime(Date.now() + 301_000); // past the 300s window
    expect(() => service.verifyChallengeTransaction(signedXdr, client.publicKey())).toThrow(
      'expired or not yet valid'
    );
    jest.useRealTimers();
  });

  it('throws at construction time when SEP10_SERVER_SECRET is not configured', async () => {
    await expect(buildService({ SEP10_SERVER_SECRET: undefined })).rejects.toThrow(
      'SEP10_SERVER_SECRET is not configured'
    );
  });
});
