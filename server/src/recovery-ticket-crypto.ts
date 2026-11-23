import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

export type EncryptedRecoveryTicket = { version: 1; nonce: string; tag: string; ciphertext: string };

export function encryptRecoveryTicket(ticket: string, pepper: string, grantId: string): EncryptedRecoveryTicket {
  if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new Error("El ticket de recuperación no tiene un formato válido.");
  const key = deriveKey(pepper);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`laural:recovery-ticket:v1:${grantId}`));
  const ciphertext = Buffer.concat([cipher.update(ticket, "utf8"), cipher.final()]);
  return { version: 1, nonce: nonce.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), ciphertext: ciphertext.toString("base64url") };
}

export function decryptRecoveryTicket(envelope: EncryptedRecoveryTicket, pepper: string, grantId: string): string {
  if (envelope.version !== 1) throw new Error("La versión del ticket cifrado no es válida.");
  const nonce = Buffer.from(envelope.nonce, "base64url");
  const tag = Buffer.from(envelope.tag, "base64url");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64url");
  if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length !== 43 || nonce.toString("base64url") !== envelope.nonce
    || tag.toString("base64url") !== envelope.tag || ciphertext.toString("base64url") !== envelope.ciphertext) {
    throw new Error("El ticket cifrado no tiene un formato válido.");
  }
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(pepper), nonce);
  decipher.setAAD(Buffer.from(`laural:recovery-ticket:v1:${grantId}`));
  decipher.setAuthTag(tag);
  const ticket = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new Error("El ticket descifrado no es válido.");
  return ticket;
}

function deriveKey(pepper: string): Buffer {
  if (Buffer.byteLength(pepper, "utf8") < 32) throw new Error("AUTH_RECOVERY_PEPPER debe tener al menos 32 bytes.");
  return createHmac("sha256", pepper).update("laural:recovery-ticket-envelope:v1").digest();
}
