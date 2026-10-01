import { createHash } from 'node:crypto';
import {
  BASE32_PREFIX,
  DAG_JSON_CODEC,
  NonCanonicalDocumentError,
  RAW_CODEC,
  canonicalizeJson,
  computeCidV1,
  computeDocumentCid,
  sha256Hex,
  toBase32,
  verifyCidV1,
} from './cid.util';

describe('cid.util', () => {
  describe('canonicalizeJson', () => {
    it('sorts keys recursively so insertion order cannot change the bytes', () => {
      const a = canonicalizeJson({ b: 2, a: [3, { z: 1, y: 2 }] });
      const b = canonicalizeJson({ a: [3, { y: 2, z: 1 }], b: 2 });
      expect(a).toBe(b);
      expect(a).toBe('{"a":[3,{"y":2,"z":1}],"b":2}');
    });

    it('keeps array order (an array is a sequence, not a set)', () => {
      expect(canonicalizeJson([1, 2, 3])).not.toBe(canonicalizeJson([3, 2, 1]));
    });

    it('drops undefined members instead of emitting invalid JSON', () => {
      expect(canonicalizeJson({ a: 1, b: undefined })).toBe('{"a":1}');
    });

    it('serialises Date as ISO-8601 and Uint8Array as hex', () => {
      expect(
        canonicalizeJson({
          at: new Date('2026-01-01T00:00:00.000Z'),
          bytes: new Uint8Array([0xde, 0xad]),
        }),
      ).toBe('{"at":"2026-01-01T00:00:00.000Z","bytes":"dead"}');
    });

    it('is stable across repeated calls on the same document', () => {
      const doc = {
        callId: 42,
        price: { source: 'dexscreener' as const, price: 25.5, scaledPrice: '25500000000000000000' },
        candles: [
          { timestamp: 1, close: 1.1 },
          { timestamp: 2, close: 1.2 },
        ],
      };
      expect(canonicalizeJson(doc)).toBe(canonicalizeJson(doc));
      expect(canonicalizeJson(doc)).toBe(canonicalizeJson({ ...doc }));
    });

    it.each([
      ['NaN', { a: Number.NaN }],
      ['Infinity', { a: Number.POSITIVE_INFINITY }],
      ['BigInt', { a: BigInt(1) }],
      ['a function', { a: () => 1 }],
    ])('refuses to canonicalise %s', (_label, doc) => {
      expect(() => canonicalizeJson(doc)).toThrow(NonCanonicalDocumentError);
    });

    it('refuses a circular document', () => {
      const doc: Record<string, unknown> = {};
      doc.self = doc;
      expect(() => canonicalizeJson(doc)).toThrow(/circular reference/);
    });
  });

  describe('toBase32', () => {
    it('encodes RFC 4648 examples, lower case and unpadded', () => {
      // RFC 4648 §10 test vectors.
      expect(toBase32(Buffer.from(''))).toBe('');
      expect(toBase32(Buffer.from('f'))).toBe('my');
      expect(toBase32(Buffer.from('fo'))).toBe('mzxq');
      expect(toBase32(Buffer.from('foo'))).toBe('mzxw6');
      expect(toBase32(Buffer.from('foobar'))).toBe('mzxw6ytboi');
    });
  });

  describe('computeCidV1', () => {
    /**
     * Vectors cross-checked against the reference `multiformats` implementation
     * (`CID.createV1(codec, await sha256.digest(bytes)).toString()`), so they
     * pin the exact byte layout rather than this module's own opinion of it.
     */
    it('matches the reference implementation for a raw block', () => {
      const bytes = Buffer.from(canonicalizeJson({ hello: 'world' }), 'utf8');
      expect(computeCidV1(bytes, RAW_CODEC)).toBe(
        'bafkreietui4xdkiu4xvmx4fi2jivjtndbhb4drzpxomrjvd4mdz4w2avra',
      );
    });

    it('matches the reference implementation for the empty block', () => {
      expect(computeCidV1(new Uint8Array(), RAW_CODEC)).toBe(
        'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
      );
    });

    it('matches the reference implementation for a dag-json block', () => {
      const bytes = Buffer.from(
        canonicalizeJson({
          audit: { actor: 'oracle-worker', at: '2026-01-01T00:00:00.000Z' },
          nested: { b: [1, null, true], a: 'x' },
        }),
        'utf8',
      );
      expect(computeCidV1(bytes, DAG_JSON_CODEC)).toBe(
        'baguqeeralaqsivi6mm7ron52ewgnz2ocuwnkcldwvxtqfnsa5ldi55d2liaq',
      );
    });

    it('matches the reference implementation for a canonical object', () => {
      const bytes = Buffer.from('{"a":1,"b":2}', 'utf8');
      expect(computeCidV1(bytes, RAW_CODEC)).toBe(
        'bafkreicdewgp66b744bw3csdam7ygcw7yyhmanzyerzvjcwhik4iqkjho4',
      );
    });

    it('produces a CIDv1 (version 1, raw codec, sha2-256) by construction', () => {
      const cid = computeCidV1(Buffer.from('x'), RAW_CODEC);
      expect(cid.startsWith(BASE32_PREFIX)).toBe(true);
      expect(cid.startsWith('bafkrei')).toBe(true); // b + 0x01 0x55 0x12 0x20
    });

    it('is deterministic: same bytes, same CID', () => {
      const bytes = Buffer.from('{"a":1}', 'utf8');
      expect(computeCidV1(bytes)).toBe(computeCidV1(bytes));
    });
  });

  describe('computeDocumentCid', () => {
    it('addresses the canonical form, so key order does not change the CID', () => {
      const one = computeDocumentCid({ b: 2, a: 1 });
      const two = computeDocumentCid({ a: 1, b: 2 });
      expect(one.cid).toBe(two.cid);
      expect(one.canonical).toBe('{"a":1,"b":2}');
      expect(one.digest).toBe(sha256Hex(Buffer.from('{"a":1,"b":2}', 'utf8')));
      expect(one.size).toBe(13);
    });

    it('reports the sha256 the CID encodes', () => {
      const { cid, digest } = computeDocumentCid({ hello: 'world' });
      expect(digest).toBe(createHash('sha256').update('{"hello":"world"}').digest('hex'));
      expect(digest).toBe('93a23971a914e5eacbf0a8d25154cda309c3c1c72fbb9914d47c60f3cb681588');
      expect(cid).toBe('bafkreietui4xdkiu4xvmx4fi2jivjtndbhb4drzpxomrjvd4mdz4w2avra');
    });
  });

  describe('verifyCidV1', () => {
    it('accepts bytes that hash to the CID', () => {
      const bytes = Buffer.from(canonicalizeJson({ a: 1 }), 'utf8');
      expect(verifyCidV1(computeCidV1(bytes), bytes)).toBe(true);
    });

    it('rejects bytes that do not', () => {
      const bytes = Buffer.from(canonicalizeJson({ a: 1 }), 'utf8');
      const tampered = Buffer.from(canonicalizeJson({ a: 2 }), 'utf8');
      expect(verifyCidV1(computeCidV1(bytes), tampered)).toBe(false);
    });

    it('reports a CIDv0 or malformed CID as not verifiable rather than throwing', () => {
      const bytes = Buffer.from('{}', 'utf8');
      expect(verifyCidV1('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG', bytes)).toBe(false);
      expect(verifyCidV1('', bytes)).toBe(false);
      expect(verifyCidV1('bafkrei', bytes)).toBe(false);
    });
  });
});
