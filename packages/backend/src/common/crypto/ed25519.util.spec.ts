import * as nacl from 'tweetnacl';
import {
  ED25519_PUBLIC_KEY_BYTES,
  ED25519_SIGNATURE_BYTES,
  parseHexBytes,
  verifyEd25519Signature,
} from './ed25519.util';

describe('ed25519.util', () => {
  // A real keypair: the signatures below are genuine, not fixtures.
  const keyPair = nacl.sign.keyPair();
  const publicKeyHex = Buffer.from(keyPair.publicKey).toString('hex');
  const message = Buffer.alloc(33, 7);
  const signatureHex = Buffer.from(
    nacl.sign.detached(new Uint8Array(message), keyPair.secretKey),
  ).toString('hex');

  describe('parseHexBytes', () => {
    it('parses exactly-sized hex, with or without the 0x prefix', () => {
      expect(parseHexBytes(publicKeyHex, ED25519_PUBLIC_KEY_BYTES)).toHaveLength(
        ED25519_PUBLIC_KEY_BYTES,
      );
      expect(parseHexBytes(`0x${publicKeyHex}`, ED25519_PUBLIC_KEY_BYTES)).toHaveLength(
        ED25519_PUBLIC_KEY_BYTES,
      );
      expect(parseHexBytes(publicKeyHex.toUpperCase(), ED25519_PUBLIC_KEY_BYTES)).toHaveLength(
        ED25519_PUBLIC_KEY_BYTES,
      );
    });

    it('returns null for the wrong length or non-hex input', () => {
      expect(parseHexBytes(publicKeyHex, ED25519_SIGNATURE_BYTES)).toBeNull();
      expect(parseHexBytes('not-hex', ED25519_PUBLIC_KEY_BYTES)).toBeNull();
      expect(parseHexBytes(undefined, ED25519_PUBLIC_KEY_BYTES)).toBeNull();
      expect(parseHexBytes(42, ED25519_PUBLIC_KEY_BYTES)).toBeNull();
    });
  });

  describe('verifyEd25519Signature', () => {
    it('accepts a genuine signature over the message', () => {
      expect(verifyEd25519Signature(message, signatureHex, publicKeyHex)).toBe(true);
    });

    it('rejects a signature whose bytes were altered', () => {
      const flipped = Buffer.from(signatureHex, 'hex');
      flipped[0] = flipped[0]! ^ 0xff;
      expect(verifyEd25519Signature(message, flipped.toString('hex'), publicKeyHex)).toBe(false);
    });

    it('rejects a signature over a different message', () => {
      expect(verifyEd25519Signature(Buffer.alloc(33, 8), signatureHex, publicKeyHex)).toBe(false);
    });

    it('rejects a different public key', () => {
      const other = nacl.sign.keyPair();
      expect(
        verifyEd25519Signature(message, signatureHex, Buffer.from(other.publicKey).toString('hex')),
      ).toBe(false);
    });

    it('returns false — never throws — for malformed or empty input', () => {
      expect(verifyEd25519Signature(message, 'not-hex', publicKeyHex)).toBe(false);
      expect(verifyEd25519Signature(message, signatureHex, 'ab')).toBe(false);
      expect(verifyEd25519Signature(new Uint8Array(0), signatureHex, publicKeyHex)).toBe(false);
    });
  });
});
