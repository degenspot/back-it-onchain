import { Injectable, Logger } from '@nestjs/common';
import { xdr } from '@stellar/stellar-sdk';
import {
  describeContractError,
  type ContractErrorInfo,
} from '../contract-errors';

/** Why a transaction failed, as far as the diagnostics can tell us. */
export type FailureKind =
  | 'contract_error'
  | 'authorization'
  | 'footprint_exhausted'
  | 'resource_limit'
  | 'host_error'
  | 'unknown';

export interface ParsedDiagnostic {
  kind: FailureKind;
  /** Message suitable for a user-facing notification. */
  message: string;
  /** Contract error wire code, when the failure carried one. */
  errorCode?: number;
  /** Rust variant name for that code. */
  errorName?: string;
  /** Contract that produced the diagnostic, in StrKey form when resolvable. */
  contractId?: string;
  /** Raw diagnostic text retained for developer debugging. */
  raw?: string;
}

export interface ParsedTransactionFailure {
  txHash?: string;
  diagnostics: ParsedDiagnostic[];
  /** The diagnostic most likely to explain the failure. */
  primary?: ParsedDiagnostic;
}

/**
 * Patterns that identify a failure class from host-error text, since the host
 * reports these as strings rather than contract error codes.
 */
const TEXT_SIGNALS: Array<{
  kind: FailureKind;
  test: RegExp;
  message: string;
}> = [
  {
    kind: 'footprint_exhausted',
    test: /footprint|read-?only entry|read-?write entry|entry not in footprint/i,
    message:
      'The transaction touched ledger entries outside its declared footprint. It needs re-simulating before submission.',
  },
  {
    kind: 'resource_limit',
    test: /resource limit|budget exceeded|exceeded.*(cpu|memory)|insufficient refundable fee/i,
    message:
      'The transaction exceeded its resource budget. Raise the resource fee or reduce the work done in one call.',
  },
  {
    kind: 'authorization',
    test: /unauthorized|authorization|require_auth|invalid signature|signature.*(missing|invalid)/i,
    message:
      'Authorization failed. A required signature was missing or did not match the invocation.',
  },
];

/**
 * Turns Soroban `diagnosticEvents` into readable failure reasons (BE-006).
 *
 * Soroban reports a failed invocation as base64 XDR — a numeric error code at
 * best, and frequently just an opaque host error. Without translation, a user
 * sees "transaction failed" and an operator sees nothing actionable.
 *
 * Every method here is defensive by contract: malformed, truncated or
 * unexpected XDR yields a low-confidence result, never a throw. This runs
 * inside the indexing loop, and a parser that crashes on one bad transaction
 * would stall ingestion for every other one.
 */
@Injectable()
export class DiagnosticParserService {
  private readonly logger = new Logger(DiagnosticParserService.name);

  /**
   * Parses a batch of base64-encoded diagnostic events.
   *
   * Entries that cannot be decoded are skipped rather than failing the batch —
   * one unreadable event should not hide the readable ones beside it.
   */
  parseDiagnosticEvents(
    events: unknown,
    txHash?: string,
  ): ParsedTransactionFailure {
    const diagnostics: ParsedDiagnostic[] = [];

    if (Array.isArray(events)) {
      for (const event of events) {
        const parsed = this.parseOne(event);
        if (parsed) diagnostics.push(parsed);
      }
    }

    return { txHash, diagnostics, primary: this.selectPrimary(diagnostics) };
  }

  /** Parses a single diagnostic event. Returns null if nothing usable. */
  private parseOne(event: unknown): ParsedDiagnostic | null {
    const raw = this.toRawString(event);
    if (!raw) return null;

    const decoded = this.tryDecode(raw);
    const text = decoded ?? raw;

    const code = this.extractErrorCode(decoded, text);
    if (code !== undefined) {
      const info: ContractErrorInfo = describeContractError(code);
      return {
        kind: 'contract_error',
        message: info.message,
        errorCode: code,
        errorName: info.name,
        contractId: this.extractContractId(text),
        raw,
      };
    }

    for (const signal of TEXT_SIGNALS) {
      if (signal.test.test(text)) {
        return {
          kind: signal.kind,
          message: signal.message,
          contractId: this.extractContractId(text),
          raw,
        };
      }
    }

    // Decoded but unrecognised: still worth recording for debugging.
    return {
      kind: decoded ? 'host_error' : 'unknown',
      message: decoded
        ? 'The transaction failed with a host error that this service does not classify.'
        : 'The transaction failed and its diagnostics could not be decoded.',
      contractId: this.extractContractId(text),
      raw,
    };
  }

  /** Normalises the several shapes an RPC may hand back into a string. */
  private toRawString(event: unknown): string | null {
    if (typeof event === 'string') return event.trim() || null;
    if (event && typeof event === 'object') {
      const candidate = event as Record<string, unknown>;
      for (const key of ['xdr', 'event', 'diagnosticEventXdr', 'raw']) {
        const value = candidate[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
      try {
        return JSON.stringify(event);
      } catch {
        return null;
      }
    }
    return null;
  }

  /** Attempts XDR decode. Returns null on anything malformed. */
  private tryDecode(raw: string): string | null {
    try {
      return this.stringifySafe(xdr.DiagnosticEvent.fromXDR(raw, 'base64'));
    } catch {
      // Not a DiagnosticEvent — try a plain ScVal, which some RPCs return.
      try {
        return this.stringifySafe(xdr.ScVal.fromXDR(raw, 'base64'));
      } catch {
        return null;
      }
    }
  }

  /**
   * Serialises a decoded XDR object to searchable text.
   *
   * The SDK's XDR classes carry buffers and cyclic references, so
   * `JSON.stringify` can throw on them; falling back to `String()` keeps a
   * degraded-but-usable representation rather than losing the event.
   */
  private stringifySafe(value: unknown): string {
    try {
      const json = JSON.stringify(value);
      if (json && json !== '{}') return json;
    } catch {
      // fall through
    }
    try {
      return String(value);
    } catch {
      return '';
    }
  }

  /**
   * Pulls a contract error code out of decoded diagnostics.
   *
   * Only codes in the contract's declared range are accepted. Soroban
   * diagnostics are full of unrelated integers (ledger numbers, budget
   * figures), so matching any number would invent errors that never happened.
   */
  private extractErrorCode(
    decoded: string | null,
    text: string,
  ): number | undefined {
    const source = decoded ?? text;

    const patterns = [
      /"contractCode"\s*:\s*(\d+)/i,
      /Error\(Contract,\s*#?(\d+)\)/i,
      /contract_error[^0-9]{0,12}(\d+)/i,
      /"code"\s*:\s*(\d+)/i,
    ];

    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match) {
        const value = Number(match[1]);
        if (Number.isInteger(value) && value > 0 && value <= 10_000) {
          return value;
        }
      }
    }
    return undefined;
  }

  /** Best-effort contract id extraction; absence is not an error. */
  private extractContractId(text: string): string | undefined {
    const match = text.match(/\bC[A-Z2-7]{55}\b/);
    return match ? match[0] : undefined;
  }

  /**
   * Picks the diagnostic that best explains the failure.
   *
   * A concrete contract error beats a generic host error: when a contract
   * rejects a stake, Soroban emits both, and the host error is the less
   * useful of the two.
   */
  private selectPrimary(
    diagnostics: ParsedDiagnostic[],
  ): ParsedDiagnostic | undefined {
    if (diagnostics.length === 0) return undefined;
    const order: FailureKind[] = [
      'contract_error',
      'authorization',
      'footprint_exhausted',
      'resource_limit',
      'host_error',
      'unknown',
    ];
    for (const kind of order) {
      const match = diagnostics.find((d) => d.kind === kind);
      if (match) return match;
    }
    return diagnostics[0];
  }

  /** Logs a parsed failure for developer debugging. */
  logFailure(failure: ParsedTransactionFailure): void {
    const primary = failure.primary;
    if (!primary) {
      this.logger.warn(
        `Transaction ${failure.txHash ?? '(unknown)'} failed with no parsable diagnostics`,
      );
      return;
    }
    this.logger.warn(
      `Transaction ${failure.txHash ?? '(unknown)'} failed: [${primary.kind}] ` +
        `${primary.errorName ? `${primary.errorName} — ` : ''}${primary.message}`,
    );
  }
}
