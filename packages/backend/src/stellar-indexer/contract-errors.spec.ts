import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CONTRACT_ERRORS, describeContractError } from './contract-errors';

/**
 * Path to the Rust enum this map mirrors. Resolved from the backend package
 * root up into the contracts workspace.
 */
const ERRORS_RS = join(
  __dirname,
  '..',
  '..',
  '..',
  'contracts-stellar',
  'governance',
  'src',
  'errors.rs',
);

/** Extracts `Variant = N,` pairs from the contract error enum. */
function parseRustVariants(source: string): Map<number, string> {
  const out = new Map<number, string>();
  const body = source.split('pub enum ContractError')[1] ?? '';
  for (const match of body.matchAll(
    /^\s*([A-Za-z][A-Za-z0-9]*)\s*=\s*(\d+)\s*,/gm,
  )) {
    out.set(Number(match[2]), match[1]);
  }
  return out;
}

describe('CONTRACT_ERRORS', () => {
  it('covers every variant declared in the contract, with matching names', () => {
    if (!existsSync(ERRORS_RS)) {
      throw new Error(
        `Expected the contract error enum at ${ERRORS_RS}. If the contracts ` +
          `package moved, update this path — silently skipping would let the ` +
          `map drift from the contract.`,
      );
    }

    const variants = parseRustVariants(readFileSync(ERRORS_RS, 'utf8'));
    expect(variants.size).toBeGreaterThan(0);

    const missing: string[] = [];
    const mismatched: string[] = [];

    for (const [code, name] of variants) {
      const mapped = CONTRACT_ERRORS[code];
      if (!mapped) {
        missing.push(`${code} (${name})`);
      } else if (mapped.name !== name) {
        mismatched.push(
          `${code}: contract says ${name}, map says ${mapped.name}`,
        );
      }
    }

    expect(missing).toEqual([]);
    expect(mismatched).toEqual([]);
  });

  it('does not map codes the contract never declares', () => {
    const variants = parseRustVariants(readFileSync(ERRORS_RS, 'utf8'));
    const stray = Object.keys(CONTRACT_ERRORS)
      .map(Number)
      .filter((code) => !variants.has(code));
    expect(stray).toEqual([]);
  });

  it('gives every code a non-empty, human-readable message', () => {
    for (const [code, info] of Object.entries(CONTRACT_ERRORS)) {
      expect(`${code}:${info.message.trim()}`).not.toBe(`${code}:`);
      // A message that is just the variant name is not a translation.
      expect(info.message).not.toBe(info.name);
    }
  });

  it('reports an unknown code as unknown rather than guessing', () => {
    const info = describeContractError(9999);
    expect(info.name).toContain('9999');
    expect(info.message).toContain('9999');
  });
});
