import { Test, TestingModule } from '@nestjs/testing';
import { DiagnosticParserService } from './diagnostic-parser.service';

describe('DiagnosticParserService', () => {
  let service: DiagnosticParserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DiagnosticParserService],
    }).compile();
    service = module.get<DiagnosticParserService>(DiagnosticParserService);
  });

  describe('contract error codes', () => {
    it('translates a contract error code into a readable message', () => {
      const result = service.parseDiagnosticEvents(
        ['Error(Contract, #9) invoking call_registry'],
        'tx1',
      );

      expect(result.primary?.kind).toBe('contract_error');
      expect(result.primary?.errorCode).toBe(9);
      expect(result.primary?.errorName).toBe('CallNotFound');
      expect(result.primary?.message).toBe('That call does not exist.');
      expect(result.txHash).toBe('tx1');
    });

    it('reads a code from a structured contractCode field', () => {
      const result = service.parseDiagnosticEvents([
        { xdr: '{"contractCode": 20}' },
      ]);
      expect(result.primary?.errorCode).toBe(20);
      expect(result.primary?.errorName).toBe('NotOnWinningSide');
    });

    it('labels an unrecognised code as unknown instead of inventing meaning', () => {
      const result = service.parseDiagnosticEvents(['Error(Contract, #7777)']);
      expect(result.primary?.errorCode).toBe(7777);
      expect(result.primary?.errorName).toContain('7777');
      expect(result.primary?.message).toContain('does not recognise');
    });

    it('ignores integers that are not contract error codes', () => {
      // A ledger number must not be mistaken for an error code.
      const result = service.parseDiagnosticEvents([
        'ledger 58123456 closed normally',
      ]);
      expect(result.primary?.errorCode).toBeUndefined();
    });
  });

  describe('failure classification', () => {
    it('identifies authorization failures', () => {
      const result = service.parseDiagnosticEvents([
        'host error: require_auth failed for account',
      ]);
      expect(result.primary?.kind).toBe('authorization');
      expect(result.primary?.message).toContain('Authorization failed');
    });

    it('identifies footprint exhaustion', () => {
      const result = service.parseDiagnosticEvents([
        'trying to access an entry not in footprint',
      ]);
      expect(result.primary?.kind).toBe('footprint_exhausted');
      expect(result.primary?.message).toContain('footprint');
    });

    it('identifies resource budget exhaustion', () => {
      const result = service.parseDiagnosticEvents([
        'budget exceeded: cpu instructions',
      ]);
      expect(result.primary?.kind).toBe('resource_limit');
    });

    it('prefers a concrete contract error over a generic host error', () => {
      const result = service.parseDiagnosticEvents([
        'host error: require_auth failed',
        'Error(Contract, #21)',
      ]);
      expect(result.primary?.kind).toBe('contract_error');
      expect(result.primary?.errorName).toBe('NothingToWithdraw');
      expect(result.diagnostics).toHaveLength(2);
    });
  });

  describe('defensive parsing', () => {
    it('never throws on malformed base64', () => {
      expect(() =>
        service.parseDiagnosticEvents(['!!!not-xdr!!!']),
      ).not.toThrow();
    });

    it('never throws on null, undefined or non-array input', () => {
      expect(() => service.parseDiagnosticEvents(null)).not.toThrow();
      expect(() => service.parseDiagnosticEvents(undefined)).not.toThrow();
      expect(() => service.parseDiagnosticEvents('not an array')).not.toThrow();
      expect(service.parseDiagnosticEvents(null).diagnostics).toEqual([]);
    });

    it('skips unusable entries but keeps the usable ones beside them', () => {
      const result = service.parseDiagnosticEvents([
        null,
        '',
        'Error(Contract, #1)',
        undefined,
      ]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.primary?.errorName).toBe('Unauthorized');
    });

    it('handles a circular object without throwing', () => {
      const circular: Record<string, unknown> = { a: 1 };
      circular.self = circular;
      expect(() => service.parseDiagnosticEvents([circular])).not.toThrow();
    });

    it('returns no primary when there is nothing to report', () => {
      const result = service.parseDiagnosticEvents([]);
      expect(result.primary).toBeUndefined();
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe('metadata', () => {
    it('extracts the contract id when the diagnostic carries one', () => {
      const contractId = 'C' + 'A'.repeat(55);
      const result = service.parseDiagnosticEvents([
        `Error(Contract, #4) from ${contractId}`,
      ]);
      expect(result.primary?.contractId).toBe(contractId);
    });

    it('retains the raw diagnostic for debugging', () => {
      const raw = 'Error(Contract, #4) detail';
      const result = service.parseDiagnosticEvents([raw]);
      expect(result.primary?.raw).toBe(raw);
    });

    it('logs a failure without throwing when diagnostics are empty', () => {
      expect(() =>
        service.logFailure({ txHash: 'tx9', diagnostics: [] }),
      ).not.toThrow();
    });
  });
});
