import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_AAD = "laural:account-totp:v1";

export type EncryptedTotpSecret = {
  version: 1;
  nonce: string;
  tag: string;
  ciphertext: string;
};

export function createTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function createTotpUri(secret: string, email: string, issuer = "Laural"): string {
  const label = `${issuer}:${email}`;
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${query.toString()}`;
}

export function totpCode(secret: string, counter: number): string {
  if (!Number.isSafeInteger(counter) || counter < 0) throw new Error("El contador TOTP no es válido.");
  const key = decodeBase32(secret);
  const movingFactor = Buffer.alloc(8);
  movingFactor.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(movingFactor).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, "0");
}

export function matchingTotpCounter(secret: string, code: string, nowMs: number, lastUsedCounter = -1): number | null {
  if (!/^\d{6}$/.test(code) || !Number.isFinite(nowMs) || nowMs < 0) return null;
  const currentCounter = Math.floor(nowMs / (TOTP_PERIOD_SECONDS * 1000));
  for (let counter = Math.max(0, currentCounter - 1); counter <= currentCounter + 1; counter += 1) {
    if (counter <= lastUsedCounter) continue;
    if (constantTimeCodeEqual(totpCode(secret, counter), code)) return counter;
  }
  return null;
}

export function encryptTotpSecret(secret: string, key: Buffer, accountId: string): EncryptedTotpSecret {
  assertEncryptionKey(key);
  decodeBase32(secret);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`${TOTP_AAD}:${accountId}`));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return {
    version: 1,
    nonce: nonce.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

export function decryptTotpSecret(envelope: EncryptedTotpSecret, key: Buffer, accountId: string): string {
  assertEncryptionKey(key);
  if (envelope.version !== 1) throw new Error("La versión del secreto TOTP no es compatible.");
  const nonce = Buffer.from(envelope.nonce, "base64url");
  const tag = Buffer.from(envelope.tag, "base64url");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64url");
  if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length < 1 || ciphertext.length > 128) {
    throw new Error("El secreto TOTP cifrado no es válido.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(Buffer.from(`${TOTP_AAD}:${accountId}`));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function createRecoveryCodes(count = 10): string[] {
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("La cantidad de códigos de recuperación no es válida.");
  return Array.from({ length: count }, () => randomBytes(8).toString("hex").toUpperCase().match(/.{1,4}/gu)!.join("-"));
}

export function recoveryCodeDigest(code: string, accountId: string, pepper: string): string {
  const normalized = code.replaceAll("-", "").toUpperCase();
  if (!/^[A-F0-9]{16}$/.test(normalized)) throw new Error("El código de recuperación no es válido.");
  if (Buffer.byteLength(pepper, "utf8") < 32) throw new Error("El pepper de recuperación debe tener al menos 32 bytes.");
  return createHmac("sha256", pepper).update("recovery-code\0").update(accountId).update("\0").update(normalized).digest("hex");
}

function encodeBase32(bytes: Buffer): string {
  let output = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(value: string): Buffer {
  if (!/^[A-Z2-7]{8,128}$/.test(value)) throw new Error("El secreto TOTP no es válido.");
  const output: number[] = [];
  let bits = 0;
  let buffer = 0;
  for (const character of value) {
    buffer = (buffer << 5) | BASE32_ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) throw new Error("El secreto TOTP no es válido.");
  return Buffer.from(output);
}

function constantTimeCodeEqual(expected: string, supplied: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

function assertEncryptionKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error("La clave de cifrado TOTP debe tener 32 bytes.");
}
